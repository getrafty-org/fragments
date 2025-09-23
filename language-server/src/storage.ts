import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

export interface Storage {
  isOpen(): boolean;
  open(versions?: string[], activeVersion?: string): Promise<void>;
  ensureFragment(fragmentId: string, currentContent?: string): Promise<void>;
  updateFragment(fragmentId: string, version: string, content: string): Promise<void>;
  getFragmentContent(fragmentId: string, version: string): Promise<string | null>;
  getActiveVersion(): Promise<string>;
  getAvailableVersions(): Promise<string[]>;
  switchVersion(versionName: string): Promise<void>;
  close(): Promise<void>;
}

const MAGIC = Buffer.from('FRAG');
const FORMAT_VERSION = 2;
const HEADER_SIZE = 256;
const VERSION_TABLE_OFFSET = 64;
const VERSION_ENTRY_SIZE = 32;
const MAX_VERSIONS = Math.floor((HEADER_SIZE - VERSION_TABLE_OFFSET) / VERSION_ENTRY_SIZE);
const INITIAL_INDEX_CAPACITY = 128;
const FRAGMENT_ID_SIZE = 32;
const INDEX_ENTRY_SIZE = 48;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_FLAG_ENCRYPTED = 0x01;

interface FileHeader {
  version: number;
  headerSize: number;
  flags: number;
  activeVersion: number;
  versionsCount: number;
  indexOffset: number;
  indexSize: number;
  indexUsed: number;
  dataStart: number;
  dataEnd: number;
}

interface DecodedIndexEntry {
  idBuffer: Buffer;
  used: boolean;
  encrypted: boolean;
  offset: number;
}

interface IndexEntryRecord {
  slot: number;
  fragmentId: string;
  idBuffer: Buffer;
  offset: number;
  used: boolean;
  encrypted: boolean;
}

const HEADER_LAYOUT = {
  magic: { offset: 0 },
  version: { offset: 4 },
  headerSize: { offset: 5 },
  flags: { offset: 9 },
  activeVersion: { offset: 10 },
  versionsCount: { offset: 11 },
  indexOffset: { offset: 16 },
  indexSize: { offset: 24 },
  indexUsed: { offset: 32 },
  dataStart: { offset: 36 },
  dataEnd: { offset: 44 }
} as const;

export class FragmentStorage implements Storage {
  private readonly storageFilePath: string;
  private readonly encryptionKey?: Buffer;

  private fileHandle: fs.promises.FileHandle | null = null;
  private header: FileHeader | null = null;
  private versions: string[] = [];
  private encryptionEnabled = false;
  private index: Map<string, IndexEntryRecord> = new Map();
  private indexEntriesBySlot: (IndexEntryRecord | null)[] = [];

  constructor(storageFilePath: string, encryptionKey?: string) {
    this.storageFilePath = storageFilePath;
    const supplied = encryptionKey ?? process.env.FRAGMENTS_ENCRYPTION_KEY;
    this.encryptionKey = supplied ? createHash('sha256').update(supplied).digest() : undefined;
    this.encryptionEnabled = Boolean(this.encryptionKey);
  }

  isOpen(): boolean {
    return this.fileHandle !== null;
  }

  async open(versions: string[] = ['public', 'private'], activeVersion: string = 'public'): Promise<void> {
    if (this.fileHandle) {
      if (!this.header) {
        await this.loadMetadata();
      }
      return;
    }

    const exists = fs.existsSync(this.storageFilePath);
    await fs.promises.mkdir(path.dirname(this.storageFilePath), { recursive: true });

    if (!exists) {
      const handle = await fs.promises.open(this.storageFilePath, 'w+');
      this.fileHandle = handle;
      await this.initializeNewFile(handle, versions, activeVersion);
    } else {
      this.fileHandle = await fs.promises.open(this.storageFilePath, 'r+');
      await this.loadMetadata();
    }
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
      this.header = null;
      this.versions = [];
      this.index.clear();
      this.indexEntriesBySlot = [];
    }
  }

  async ensureFragment(fragmentId: string, currentContent: string = ''): Promise<void> {
    await this.ensureOpen();
    const idBuffer = this.normalizeFragmentId(fragmentId);
    const idKey = idBuffer.toString('hex');
    if (this.index.has(idKey)) {
      return;
    }

    await this.ensureIndexCapacity(1);

    const contents = new Array(this.versions.length).fill('');
    const activeIndex = this.header!.activeVersion;
    contents[activeIndex] = currentContent;
    await this.writeFragmentData(idBuffer, contents);
  }

  async updateFragment(fragmentId: string, version: string, content: string): Promise<void> {
    await this.ensureOpen();
    const versionIndex = this.getVersionIndex(version);
    const idBuffer = this.normalizeFragmentId(fragmentId);
    const idKey = idBuffer.toString('hex');

    if (!this.index.has(idKey)) {
      await this.ensureFragment(fragmentId);
    }

    const entry = this.index.get(idKey);
    if (!entry || !entry.used) {
      throw new Error(`Failed to locate index entry for fragment '${fragmentId}'.`);
    }

    const contents = await this.readFragmentVersions(entry);
    contents[versionIndex] = content;
    await this.writeFragmentData(idBuffer, contents);
  }

  async getFragmentContent(fragmentId: string, version: string): Promise<string | null> {
    await this.ensureOpen();
    const versionIndex = this.getVersionIndex(version);
    const idKey = this.normalizeFragmentId(fragmentId).toString('hex');
    const entry = this.index.get(idKey);
    if (!entry || !entry.used) {
      return null;
    }

    const contents = await this.readFragmentVersions(entry);
    return contents[versionIndex] ?? '';
  }

  async getActiveVersion(): Promise<string> {
    await this.ensureOpen();
    return this.versions[this.header!.activeVersion];
  }

  async getAvailableVersions(): Promise<string[]> {
    await this.ensureOpen();
    return [...this.versions];
  }

  async switchVersion(versionName: string): Promise<void> {
    await this.ensureOpen();
    const index = this.versions.indexOf(versionName);
    if (index === -1) {
      throw new Error(`Version '${versionName}' does not exist.`);
    }
    this.header!.activeVersion = index;
    await this.persistHeader();
  }

  private async ensureOpen(): Promise<void> {
    if (!this.fileHandle || !this.header) {
      await this.open();
    }
  }

  private async initializeNewFile(
    handle: fs.promises.FileHandle,
    versions: string[],
    activeVersion: string
  ): Promise<void> {
    const versionSet = Array.from(new Set(versions));
    if (versionSet.length === 0) {
      throw new Error('At least one version must be provided when initializing storage.');
    }
    if (versionSet.length > MAX_VERSIONS) {
      throw new Error(`Storage header supports up to ${MAX_VERSIONS} versions.`);
    }

    const activeIndex = Math.max(0, versionSet.indexOf(activeVersion));

    const header: FileHeader = {
      version: FORMAT_VERSION,
      headerSize: HEADER_SIZE,
      flags: this.encryptionEnabled ? HEADER_FLAG_ENCRYPTED : 0,
      activeVersion: activeIndex,
      versionsCount: versionSet.length,
      indexOffset: HEADER_SIZE,
      indexSize: INITIAL_INDEX_CAPACITY * INDEX_ENTRY_SIZE,
      indexUsed: 0,
      dataStart: HEADER_SIZE + INITIAL_INDEX_CAPACITY * INDEX_ENTRY_SIZE,
      dataEnd: HEADER_SIZE + INITIAL_INDEX_CAPACITY * INDEX_ENTRY_SIZE
    };

    this.header = header;
    this.versions = versionSet;
    this.index.clear();
    this.indexEntriesBySlot = new Array(this.getIndexCapacity()).fill(null);

    const headerBuffer = this.buildHeaderBuffer();
    await handle.write(headerBuffer, 0, headerBuffer.length, 0);

    const indexBuffer = Buffer.alloc(header.indexSize, 0);
    await handle.write(indexBuffer, 0, indexBuffer.length, header.indexOffset);
    await handle.sync();
  }

  private async loadMetadata(): Promise<void> {
    const handle = this.fileHandle!;
    const headerBuffer = Buffer.alloc(HEADER_SIZE);
    await handle.read(headerBuffer, 0, HEADER_SIZE, 0);

    if (!headerBuffer.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid fragments storage format magic.');
    }

    const formatVersion = headerBuffer.readUInt8(HEADER_LAYOUT.version.offset);
    if (formatVersion !== FORMAT_VERSION) {
      throw new Error(`Unsupported storage format version: ${formatVersion}`);
    }

    const headerSize = headerBuffer.readUInt32BE(HEADER_LAYOUT.headerSize.offset);
    if (headerSize !== HEADER_SIZE) {
      throw new Error(`Unexpected header size ${headerSize}, expected ${HEADER_SIZE}.`);
    }

    const flags = headerBuffer.readUInt8(HEADER_LAYOUT.flags.offset);
    const versionsCount = headerBuffer.readUInt8(HEADER_LAYOUT.versionsCount.offset);
    if (versionsCount > MAX_VERSIONS) {
      throw new Error(`Stored versions count ${versionsCount} exceeds supported limit ${MAX_VERSIONS}.`);
    }

    const header: FileHeader = {
      version: formatVersion,
      headerSize,
      flags,
      activeVersion: headerBuffer.readUInt8(HEADER_LAYOUT.activeVersion.offset),
      versionsCount,
      indexOffset: Number(headerBuffer.readBigUInt64BE(HEADER_LAYOUT.indexOffset.offset)),
      indexSize: Number(headerBuffer.readBigUInt64BE(HEADER_LAYOUT.indexSize.offset)),
      indexUsed: headerBuffer.readUInt32BE(HEADER_LAYOUT.indexUsed.offset),
      dataStart: Number(headerBuffer.readBigUInt64BE(HEADER_LAYOUT.dataStart.offset)),
      dataEnd: Number(headerBuffer.readBigUInt64BE(HEADER_LAYOUT.dataEnd.offset))
    };

    const encryptionRequired = (flags & HEADER_FLAG_ENCRYPTED) !== 0;
    if (encryptionRequired && !this.encryptionKey) {
      throw new Error('Storage requires encryption key which was not provided.');
    }
    this.encryptionEnabled = encryptionRequired;

    const versions: string[] = [];
    for (let i = 0; i < versionsCount; i++) {
      const offset = VERSION_TABLE_OFFSET + i * VERSION_ENTRY_SIZE;
      const slice = headerBuffer.subarray(offset, offset + VERSION_ENTRY_SIZE);
      const name = slice.toString('utf8').replace(/\0+$/, '');
      versions.push(name);
    }

    this.header = header;
    this.versions = versions;
    this.index.clear();

    const capacity = this.getIndexCapacity();
    this.ensureSlotArrayCapacity(capacity);

    if (header.indexUsed === 0) {
      return;
    }

    const bytesToRead = header.indexUsed * INDEX_ENTRY_SIZE;
    const indexBuffer = Buffer.alloc(bytesToRead);
    await handle.read(indexBuffer, 0, bytesToRead, header.indexOffset);

    for (let slot = 0; slot < header.indexUsed; slot++) {
      const slice = indexBuffer.subarray(slot * INDEX_ENTRY_SIZE, (slot + 1) * INDEX_ENTRY_SIZE);
      const decoded = this.decodeIndexEntry(slice);
      if (!decoded.used) {
        this.indexEntriesBySlot[slot] = null;
        continue;
      }
      const fragmentId = decoded.idBuffer.toString('hex');
      const record: IndexEntryRecord = {
        slot,
        fragmentId,
        idBuffer: decoded.idBuffer,
        offset: decoded.offset,
        used: decoded.used,
        encrypted: decoded.encrypted
      };
      this.indexEntriesBySlot[slot] = record;
      this.index.set(fragmentId, record);
    }
  }

  private async writeFragmentData(idBuffer: Buffer, versionContents: string[]): Promise<void> {
    const handle = await this.getFileHandle();

    const aligned = this.alignContents(versionContents);
    const serialized = Buffer.from(JSON.stringify(aligned), 'utf8');
    const compressed = zlib.gzipSync(serialized);
    const payload = this.encryptionEnabled ? this.encryptBuffer(compressed) : compressed;

    const chunkBuffer = Buffer.allocUnsafe(4 + payload.length);
    chunkBuffer.writeUInt32BE(payload.length, 0);
    payload.copy(chunkBuffer, 4);

    const writeOffset = this.header!.dataEnd;
    await handle.write(chunkBuffer, 0, chunkBuffer.length, writeOffset);
    this.header!.dataEnd = writeOffset + chunkBuffer.length;

    const entry = await this.upsertIndexEntry(idBuffer, writeOffset, this.encryptionEnabled);
    this.indexEntriesBySlot[entry.slot] = entry;
    this.index.set(entry.fragmentId, entry);

    await this.persistHeader();
    await handle.sync();
  }

  private alignContents(contents: string[]): string[] {
    const result = new Array(this.versions.length).fill('');
    for (let i = 0; i < Math.min(contents.length, this.versions.length); i++) {
      result[i] = typeof contents[i] === 'string' ? contents[i] : '';
    }
    return result;
  }

  private async readFragmentVersions(entry: IndexEntryRecord): Promise<string[]> {
    const handle = await this.getFileHandle();
    const lengthBuffer = Buffer.alloc(4);
    await handle.read(lengthBuffer, 0, 4, entry.offset);
    const payloadLength = lengthBuffer.readUInt32BE(0);
    if (payloadLength === 0) {
      return new Array(this.versions.length).fill('');
    }

    const payload = Buffer.alloc(payloadLength);
    await handle.read(payload, 0, payloadLength, entry.offset + 4);

    const compressedPayload = entry.encrypted ? this.decryptBuffer(payload) : payload;

    const decompressed = zlib.gunzipSync(compressedPayload);
    const parsed = JSON.parse(decompressed.toString('utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('Corrupted fragment payload: expected array.');
    }

    return this.alignContents(parsed);
  }

  private async persistHeader(): Promise<void> {
    const handle = await this.getFileHandle();
    this.header!.version = FORMAT_VERSION;
    this.header!.headerSize = HEADER_SIZE;
    this.header!.versionsCount = this.versions.length;
    this.header!.flags = this.encryptionEnabled ? HEADER_FLAG_ENCRYPTED : 0;
    const headerBuffer = this.buildHeaderBuffer();
    await handle.write(headerBuffer, 0, headerBuffer.length, 0);
  }

  private buildHeaderBuffer(): Buffer {
    if (!this.header) {
      throw new Error('Storage header is not initialized.');
    }

    if (this.versions.length > MAX_VERSIONS) {
      throw new Error(`Header can encode up to ${MAX_VERSIONS} versions.`);
    }

    const buffer = Buffer.alloc(HEADER_SIZE, 0);
    MAGIC.copy(buffer, HEADER_LAYOUT.magic.offset);
    buffer.writeUInt8(this.header.version, HEADER_LAYOUT.version.offset);
    buffer.writeUInt32BE(this.header.headerSize, HEADER_LAYOUT.headerSize.offset);
    buffer.writeUInt8(this.header.flags, HEADER_LAYOUT.flags.offset);
    buffer.writeUInt8(this.header.activeVersion, HEADER_LAYOUT.activeVersion.offset);
    buffer.writeUInt8(this.header.versionsCount, HEADER_LAYOUT.versionsCount.offset);
    buffer.writeBigUInt64BE(BigInt(this.header.indexOffset), HEADER_LAYOUT.indexOffset.offset);
    buffer.writeBigUInt64BE(BigInt(this.header.indexSize), HEADER_LAYOUT.indexSize.offset);
    buffer.writeUInt32BE(this.header.indexUsed, HEADER_LAYOUT.indexUsed.offset);
    buffer.writeBigUInt64BE(BigInt(this.header.dataStart), HEADER_LAYOUT.dataStart.offset);
    buffer.writeBigUInt64BE(BigInt(this.header.dataEnd), HEADER_LAYOUT.dataEnd.offset);

    for (let i = 0; i < this.versions.length; i++) {
      const offset = VERSION_TABLE_OFFSET + i * VERSION_ENTRY_SIZE;
      const nameBuffer = Buffer.from(this.versions[i], 'utf8');
      if (nameBuffer.length >= VERSION_ENTRY_SIZE) {
        throw new Error(`Version name '${this.versions[i]}' exceeds ${VERSION_ENTRY_SIZE - 1} bytes.`);
      }
      nameBuffer.copy(buffer, offset);
    }

    return buffer;
  }

  private async upsertIndexEntry(idBuffer: Buffer, offset: number, encrypted: boolean): Promise<IndexEntryRecord> {
    const handle = await this.getFileHandle();
    const idKey = idBuffer.toString('hex');
    let record = this.index.get(idKey);

    if (!record) {
      const capacity = this.getIndexCapacity();
      if (this.header!.indexUsed >= capacity) {
        throw new Error('Index capacity exhausted while inserting new fragment.');
      }
      const slot = this.header!.indexUsed;
      const entryBuffer = this.buildIndexEntryBuffer(idBuffer, offset, encrypted, true);
      const position = this.header!.indexOffset + slot * INDEX_ENTRY_SIZE;
      await handle.write(entryBuffer, 0, entryBuffer.length, position);

      record = {
        slot,
        fragmentId: idKey,
        idBuffer: Buffer.from(idBuffer),
        offset,
        used: true,
        encrypted
      };
      this.header!.indexUsed = slot + 1;
      this.indexEntriesBySlot[slot] = record;
      this.index.set(idKey, record);
    } else {
      record.offset = offset;
      record.encrypted = encrypted;
      record.used = true;
      const entryBuffer = this.buildIndexEntryBuffer(record.idBuffer, record.offset, record.encrypted, record.used);
      const position = this.header!.indexOffset + record.slot * INDEX_ENTRY_SIZE;
      await handle.write(entryBuffer, 0, entryBuffer.length, position);
    }

    return record;
  }

  private buildIndexEntryBuffer(idBuffer: Buffer, offset: number, encrypted: boolean, used: boolean): Buffer {
    const buffer = Buffer.alloc(INDEX_ENTRY_SIZE, 0);
    idBuffer.copy(buffer, 0, 0, Math.min(idBuffer.length, FRAGMENT_ID_SIZE));
    const flags = (used ? 0x01 : 0) | (encrypted ? 0x02 : 0);
    buffer.writeUInt8(flags, FRAGMENT_ID_SIZE);
    buffer.writeBigUInt64BE(BigInt(offset), FRAGMENT_ID_SIZE + 1);
    return buffer;
  }

  private decodeIndexEntry(buffer: Buffer): DecodedIndexEntry {
    const idBuffer = Buffer.alloc(FRAGMENT_ID_SIZE);
    buffer.copy(idBuffer, 0, 0, FRAGMENT_ID_SIZE);
    const flags = buffer.readUInt8(FRAGMENT_ID_SIZE);
    const offset = Number(buffer.readBigUInt64BE(FRAGMENT_ID_SIZE + 1));
    return {
      idBuffer,
      used: (flags & 0x01) !== 0,
      encrypted: (flags & 0x02) !== 0,
      offset
    };
  }

  private normalizeFragmentId(fragmentId: string): Buffer {
    const idBuffer = Buffer.from(fragmentId, 'utf8');
    if (idBuffer.length === FRAGMENT_ID_SIZE) {
      return idBuffer;
    }
    if (idBuffer.length > FRAGMENT_ID_SIZE) {
      return idBuffer.subarray(0, FRAGMENT_ID_SIZE);
    }
    const padded = Buffer.alloc(FRAGMENT_ID_SIZE, 0);
    idBuffer.copy(padded, 0, 0, idBuffer.length);
    return padded;
  }

  private getVersionIndex(version: string): number {
    const index = this.versions.indexOf(version);
    if (index === -1) {
      throw new Error(`Version '${version}' does not exist.`);
    }
    return index;
  }

  private getIndexCapacity(): number {
    if (!this.header) {
      return 0;
    }
    return Math.floor(this.header.indexSize / INDEX_ENTRY_SIZE);
  }

  private ensureSlotArrayCapacity(capacity: number): void {
    if (this.indexEntriesBySlot.length < capacity) {
      const missing = capacity - this.indexEntriesBySlot.length;
      this.indexEntriesBySlot.push(...new Array(missing).fill(null));
    }
  }

  private async ensureIndexCapacity(additional: number): Promise<void> {
    const header = this.header!;
    const capacity = this.getIndexCapacity();
    if (header.indexUsed + additional <= capacity) {
      return;
    }

    let newCapacity = capacity === 0 ? INITIAL_INDEX_CAPACITY : capacity;
    while (header.indexUsed + additional > newCapacity) {
      newCapacity *= 2;
    }

    await this.expandIndex(newCapacity);
  }

  private async expandIndex(newCapacity: number): Promise<void> {
    const handle = await this.getFileHandle();
    const header = this.header!;
    const currentCapacity = this.getIndexCapacity();
    if (newCapacity <= currentCapacity) {
      return;
    }

    const oldIndexSize = header.indexSize;
    const newIndexSize = newCapacity * INDEX_ENTRY_SIZE;
    const growth = newIndexSize - oldIndexSize;

    const oldDataStart = header.dataStart;
    const oldDataEnd = header.dataEnd;
    const newDataStart = header.indexOffset + newIndexSize;
    const newDataEnd = oldDataEnd + growth;

    const dataLength = oldDataEnd - oldDataStart;
    if (growth > 0 && dataLength > 0) {
      const chunkSize = 1024 * 1024;
      let remaining = dataLength;
      while (remaining > 0) {
        const step = Math.min(chunkSize, remaining);
        const readPosition = oldDataStart + remaining - step;
        const writePosition = newDataStart + remaining - step;
        const buffer = Buffer.alloc(step);
        await handle.read(buffer, 0, step, readPosition);
        await handle.write(buffer, 0, step, writePosition);
        remaining -= step;
      }
    }

    header.indexSize = newIndexSize;
    header.dataStart = newDataStart;
    header.dataEnd = newDataEnd;

    const indexBuffer = Buffer.alloc(newIndexSize, 0);
    for (let slot = 0; slot < header.indexUsed; slot++) {
      const record = this.indexEntriesBySlot[slot];
      if (!record || !record.used) {
        continue;
      }
      record.offset += growth;
      const entryBuffer = this.buildIndexEntryBuffer(record.idBuffer, record.offset, record.encrypted, record.used);
      entryBuffer.copy(indexBuffer, slot * INDEX_ENTRY_SIZE);
    }

    await handle.write(indexBuffer, 0, indexBuffer.length, header.indexOffset);

    this.ensureSlotArrayCapacity(newCapacity);

    await this.persistHeader();
    await handle.sync();
  }

  private encryptBuffer(plaintext: Buffer): Buffer {
    if (!this.encryptionKey) {
      throw new Error('Encryption key is not available.');
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const result = Buffer.alloc(iv.length + encrypted.length + authTag.length);
    iv.copy(result, 0);
    encrypted.copy(result, iv.length);
    authTag.copy(result, iv.length + encrypted.length);
    return result;
  }

  private decryptBuffer(payload: Buffer): Buffer {
    if (!this.encryptionKey) {
      throw new Error('Encryption key is required to decrypt payload.');
    }
    if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Corrupted payload: too short for AES-GCM.');
    }

    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH, payload.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private async getFileHandle(): Promise<fs.promises.FileHandle> {
    if (!this.fileHandle) {
      await this.open();
    }
    if (!this.fileHandle) {
      throw new Error('Failed to obtain file handle.');
    }
    return this.fileHandle;
  }
}
