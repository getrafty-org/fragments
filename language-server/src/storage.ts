import * as fs from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { FragmentId } from 'fgmpack-protocol';

export interface Storage {
  isOpen(): boolean;
  open(versions?: string[], activeVersion?: string): Promise<void>;
  ensureFragment(fragmentId: FragmentId, currentContent?: string): Promise<void>;
  updateFragment(fragmentId: FragmentId, version: string, content: string): Promise<void>;
  getFragmentContent(fragmentId: FragmentId, version: string): Promise<string | null>;
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
const INITIAL_INDEX_CAPACITY = 1024;
const FRAGMENT_ID_SIZE = 2;
const INDEX_ENTRY_SIZE = 10;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_FLAG_ENCRYPTED = 0x01;
const COMPACTION_DENSITY_THRESHOLD = 0.6;
const COMPACTION_MIN_FRAGMENTS = 8;
const COMPACTION_MIN_BYTES = 64 * 1024;
const EMPTY_BUFFER = Buffer.alloc(0);

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
  length: number;
}

interface IndexEntryRecord {
  slot: number;
  fragmentId: FragmentId;
  idBuffer: Buffer;
  offset: number;
  length: number;
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
  private index: Map<FragmentId, IndexEntryRecord> = new Map();
  private indexEntriesBySlot: (IndexEntryRecord | null)[] = [];
  private isCompacting = false;
  private liveDataBytes = 0;

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

  async ensureFragment(fragmentId: FragmentId, currentContent: string = ''): Promise<void> {
    await this.ensureOpen();

    if (this.index.has(fragmentId)) {
      return;
    }

    await this.ensureIndexCapacity(1);

    const contents = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER);
    const activeIndex = this.header!.activeVersion;
    contents[activeIndex] = Buffer.from(currentContent, 'utf8');
    const idBuffer = Buffer.from(fragmentId, 'hex');
    await this.writeFragmentData(idBuffer, contents);
  }

  async updateFragment(fragmentId: FragmentId, version: string, content: string): Promise<void> {
    await this.ensureOpen();
    const versionIndex = this.getVersionIndex(version);

    const entry = this.index.get(fragmentId);
    if (!entry || !entry.used) {
      throw new Error(`Fragment '${fragmentId}' does not exist.`);
    }

    const contents = await this.readFragmentBuffers(entry);
    contents[versionIndex] = Buffer.from(content, 'utf8');
    await this.writeFragmentData(entry.idBuffer, contents);
  }

  async getFragmentContent(fragmentId: FragmentId, version: string): Promise<string | null> {
    await this.ensureOpen();
    const versionIndex = this.getVersionIndex(version);

    const entry = this.index.get(fragmentId);
    if (!entry || !entry.used) {
      return null;
    }

    const contents = await this.readFragmentBuffers(entry);
    const buffer = contents[versionIndex];
    return buffer ? buffer.toString('utf8') : '';
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
    this.liveDataBytes = 0;

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
      const fragmentId = decoded.idBuffer.toString('hex') as FragmentId;
      const record: IndexEntryRecord = {
        slot,
        fragmentId,
        idBuffer: decoded.idBuffer,
        offset: decoded.offset,
        length: decoded.length,
        used: decoded.used,
        encrypted: decoded.encrypted
      };
      this.indexEntriesBySlot[slot] = record;
      this.index.set(fragmentId, record);
      this.liveDataBytes += record.length;
    }
  }

  private async writeFragmentData(
    idBuffer: Buffer,
    versionContents: Buffer[],
    skipCompaction: boolean = false
  ): Promise<void> {
    const handle = await this.getFileHandle();

    const aligned = this.alignContents(versionContents);
    const encoded = this.encodeFragmentContents(aligned);
    const payload = this.encryptionEnabled ? this.encryptBuffer(encoded) : encoded;

    const chunkBuffer = Buffer.allocUnsafe(4 + payload.length);
    chunkBuffer.writeUInt32BE(payload.length, 0);
    payload.copy(chunkBuffer, 4);

    const writeOffset = this.header!.dataEnd;
    await handle.write(chunkBuffer, 0, chunkBuffer.length, writeOffset);
    this.header!.dataEnd = writeOffset + chunkBuffer.length;

    const fragmentId = idBuffer.toString('hex') as FragmentId;
    const previousLength = this.index.get(fragmentId)?.length ?? 0;
    const entry = await this.upsertIndexEntry(
      fragmentId,
      idBuffer,
      writeOffset,
      chunkBuffer.length,
      this.encryptionEnabled
    );
    this.indexEntriesBySlot[entry.slot] = entry;
    this.index.set(fragmentId, entry);

    this.liveDataBytes += entry.length - previousLength;

    await this.persistHeader();
    await handle.sync();

    if (!skipCompaction) {
      await this.maybeCompactStorage();
    }
  }

  private alignContents(contents: Buffer[]): Buffer[] {
    const result = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER);
    for (let i = 0; i < Math.min(contents.length, this.versions.length); i++) {
      result[i] = contents[i] ?? EMPTY_BUFFER;
    }
    return result;
  }

  private async readFragmentBuffers(entry: IndexEntryRecord): Promise<Buffer[]> {
    const handle = await this.getFileHandle();
    const chunkLength = entry.length;
    if (chunkLength <= 4) {
      throw new Error('Corrupted fragment payload: invalid chunk length.');
    }

    const chunkBuffer = Buffer.alloc(chunkLength);
    await handle.read(chunkBuffer, 0, chunkLength, entry.offset);

    const payloadLength = chunkBuffer.readUInt32BE(0);
    if (payloadLength === 0) {
      return new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER);
    }
    if (payloadLength + 4 !== chunkLength) {
      throw new Error('Corrupted fragment payload: mismatched length.');
    }

    const payload = chunkBuffer.subarray(4);
    const dataBuffer = entry.encrypted ? this.decryptBuffer(payload) : payload;

    return this.decodeFragmentContents(dataBuffer);
  }

  private calculateUsedDataBytes(): number {
    return this.liveDataBytes;
  }

  private async maybeCompactStorage(): Promise<void> {
    if (!this.header || this.isCompacting) {
      return;
    }

    const totalSpan = this.header.dataEnd - this.header.dataStart;
    if (totalSpan <= 0 || totalSpan < COMPACTION_MIN_BYTES) {
      return;
    }
    if (this.header.indexUsed < COMPACTION_MIN_FRAGMENTS) {
      return;
    }

    const usedBytes = this.calculateUsedDataBytes();
    if (usedBytes === 0) {
      return;
    }

    const density = usedBytes / totalSpan;
    if (density >= COMPACTION_DENSITY_THRESHOLD) {
      return;
    }

    await this.compactStorage();
  }

  private async compactStorage(): Promise<void> {
    if (!this.header || this.isCompacting) {
      return;
    }

    const activeRecords = this.indexEntriesBySlot.filter(
      (record): record is IndexEntryRecord => Boolean(record && record.used)
    );
    if (activeRecords.length === 0) {
      return;
    }

    this.isCompacting = true;
    try {
      const fragments: { idBuffer: Buffer; contents: Buffer[] }[] = [];
      for (const record of activeRecords) {
        const contents = await this.readFragmentBuffers(record);
        fragments.push({ idBuffer: Buffer.from(record.idBuffer), contents });
      }

      const handle = await this.getFileHandle();

      this.index.clear();
      this.indexEntriesBySlot = new Array(this.getIndexCapacity()).fill(null);
      this.header.indexUsed = 0;
      this.header.dataStart = this.header.indexOffset + this.header.indexSize;
      this.header.dataEnd = this.header.dataStart;
      this.liveDataBytes = 0;

      await handle.truncate(this.header.dataStart);

      for (const fragment of fragments) {
        await this.writeFragmentData(fragment.idBuffer, fragment.contents, true);
      }

      await this.persistHeader();
      await handle.sync();
    } finally {
      this.isCompacting = false;
    }
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

  private async upsertIndexEntry(
    fragmentId: FragmentId,
    idBuffer: Buffer,
    offset: number,
    length: number,
    encrypted: boolean
  ): Promise<IndexEntryRecord> {
    const handle = await this.getFileHandle();
    let record = this.index.get(fragmentId);

    if (!record) {
      const capacity = this.getIndexCapacity();
      if (this.header!.indexUsed >= capacity) {
        throw new Error('Index capacity exhausted while inserting new fragment.');
      }
      const slot = this.header!.indexUsed;
      const entryBuffer = this.buildIndexEntryBuffer(idBuffer, offset, length, encrypted, true);
      const position = this.header!.indexOffset + slot * INDEX_ENTRY_SIZE;
      await handle.write(entryBuffer, 0, entryBuffer.length, position);

      record = {
        slot,
        fragmentId,
        idBuffer: Buffer.from(idBuffer),
        offset,
        length,
        used: true,
        encrypted
      };
      this.header!.indexUsed = slot + 1;
      this.indexEntriesBySlot[slot] = record;
      this.index.set(fragmentId, record);
    } else {
      record.offset = offset;
      record.length = length;
      record.encrypted = encrypted;
      record.used = true;
      const entryBuffer = this.buildIndexEntryBuffer(
        record.idBuffer,
        record.offset,
        record.length,
        record.encrypted,
        record.used
      );
      const position = this.header!.indexOffset + record.slot * INDEX_ENTRY_SIZE;
      await handle.write(entryBuffer, 0, entryBuffer.length, position);
      this.index.set(fragmentId, record);
    }

    return record;
  }

  private buildIndexEntryBuffer(
    idBuffer: Buffer,
    offset: number,
    length: number,
    encrypted: boolean,
    used: boolean
  ): Buffer {
    const buffer = Buffer.alloc(INDEX_ENTRY_SIZE, 0);
    idBuffer.copy(buffer, 0, 0, FRAGMENT_ID_SIZE);
    const flags = (used ? 0x01 : 0) | (encrypted ? 0x02 : 0);
    buffer.writeUInt8(flags, FRAGMENT_ID_SIZE);
    buffer.writeUInt32BE(offset >>> 0, FRAGMENT_ID_SIZE + 1);
    buffer.writeUInt16BE(length & 0xffff, FRAGMENT_ID_SIZE + 5);
    return buffer;
  }

  private decodeIndexEntry(buffer: Buffer): DecodedIndexEntry {
    const idBuffer = Buffer.alloc(FRAGMENT_ID_SIZE);
    buffer.copy(idBuffer, 0, 0, FRAGMENT_ID_SIZE);
    const flags = buffer.readUInt8(FRAGMENT_ID_SIZE);
    const offset = buffer.readUInt32BE(FRAGMENT_ID_SIZE + 1);
    const length = buffer.readUInt16BE(FRAGMENT_ID_SIZE + 5);
    return {
      idBuffer,
      used: (flags & 0x01) !== 0,
      encrypted: (flags & 0x02) !== 0,
      offset,
      length
    };
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
      const entryBuffer = this.buildIndexEntryBuffer(
        record.idBuffer,
        record.offset,
        record.length,
        record.encrypted,
        record.used
      );
      entryBuffer.copy(indexBuffer, slot * INDEX_ENTRY_SIZE);
    }

    await handle.write(indexBuffer, 0, indexBuffer.length, header.indexOffset);

    this.ensureSlotArrayCapacity(newCapacity);

    await this.persistHeader();
    await handle.sync();
  }

  private encodeFragmentContents(contents: Buffer[]): Buffer {
    const entries: { versionIndex: number; data: Buffer }[] = [];
    let totalDataLength = 0;

    for (let i = 0; i < contents.length; i++) {
      const value = contents[i];
      if (!value || value.length === 0) {
        continue;
      }
      entries.push({ versionIndex: i, data: value });
      totalDataLength += value.length;
    }

    const entryCount = entries.length;
    const metadataSize = entryCount * (1 + 4);
    const bufferLength = 2 + metadataSize + totalDataLength;
    const buffer = Buffer.allocUnsafe(bufferLength > 0 ? bufferLength : 2);
    buffer.writeUInt16BE(entryCount, 0);

    let metaOffset = 2;
    let dataOffset = 2 + metadataSize;
    for (const entry of entries) {
      buffer.writeUInt8(entry.versionIndex, metaOffset);
      metaOffset += 1;
      buffer.writeUInt32BE(entry.data.length, metaOffset);
      metaOffset += 4;
      entry.data.copy(buffer, dataOffset);
      dataOffset += entry.data.length;
    }

    if (entryCount === 0) {
      return buffer.subarray(0, 2);
    }

    return buffer;
  }

  private decodeFragmentContents(buffer: Buffer): Buffer[] {
    if (buffer.length === 0) {
      return new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER);
    }

    if (buffer.length < 2) {
      throw new Error('Corrupted fragment payload: missing entry count.');
    }

    const entryCount = buffer.readUInt16BE(0);
    const metadataSize = entryCount * (1 + 4);
    const metadataEnd = 2 + metadataSize;
    if (buffer.length < metadataEnd) {
      throw new Error('Corrupted fragment payload: truncated metadata.');
    }

    const contents = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER);
    let metaOffset = 2;
    let dataOffset = metadataEnd;

    for (let i = 0; i < entryCount; i++) {
      const versionIndex = buffer.readUInt8(metaOffset);
      metaOffset += 1;
      const length = buffer.readUInt32BE(metaOffset);
      metaOffset += 4;

      const end = dataOffset + length;
      if (end > buffer.length) {
        throw new Error('Corrupted fragment payload: data exceeds buffer bounds.');
      }

      if (versionIndex < contents.length) {
        contents[versionIndex] = length > 0 ? buffer.subarray(dataOffset, end) : EMPTY_BUFFER;
      }

      dataOffset = end;
    }

    return contents;
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
