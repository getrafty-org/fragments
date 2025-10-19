import * as fs from 'fs'
import * as path from 'path'
import { FragmentID } from 'fgmpack-protocol'

export interface Storage {
  isOpen(): boolean
  open(versions?: string[], activeVersion?: string): Promise<void>
  upsertFragment(id: FragmentID, currentContent?: string, version?: string | null): Promise<void>
  getFragmentContent(id: FragmentID, version: string): Promise<string | null>
  getAvailableVersions(): Promise<string[]>
  getActiveVersion(): Promise<string>
  setActiveVersion(versionName: string): Promise<void>
  close(): Promise<void>
}

const MAGIC = Buffer.from('FRAG')
const FORMAT_VERSION = 2
const HEADER_SIZE = 256
const VERSION_TABLE_OFFSET = 64
const VERSION_ENTRY_SIZE = 32
const MAX_VERSIONS = Math.floor((HEADER_SIZE - VERSION_TABLE_OFFSET) / VERSION_ENTRY_SIZE)
const INITIAL_INDEX_CAPACITY = 1024
const FRAGMENT_ID_SIZE = 2
const INDEX_ENTRY_SIZE = 10
const HEADER_FLAG_ENCRYPTED = 0x01
const COMPACTION_DENSITY_THRESHOLD = 0.6
const COMPACTION_MIN_FRAGMENTS = 8
const COMPACTION_MIN_BYTES = 64 * 1024
const INCREMENTAL_COMPACTION_MAX_BYTES = 512 * 1024
const EMPTY_BUFFER = Buffer.alloc(0)

interface Extent {
  offset: number
  length: number
}

class IndexEntryView {
  private static readonly ID_OFFSET = 0
  private static readonly FLAGS_OFFSET = 2
  private static readonly DATA_OFFSET = 3
  private static readonly LENGTH_OFFSET = 7
  private static readonly PAD_OFFSET = 9

  constructor(private buf: Buffer, private base: number) { }

  get id() { return this.buf.readUInt16BE(this.base + IndexEntryView.ID_OFFSET) }
  set id(v: number) { this.buf.writeUInt16BE(v & 0xffff, this.base + IndexEntryView.ID_OFFSET) }

  get flags() { return this.buf.readUInt8(this.base + IndexEntryView.FLAGS_OFFSET) }
  set flags(v: number) { this.buf.writeUInt8(v & 0xff, this.base + IndexEntryView.FLAGS_OFFSET) }

  get used() { return (this.flags & 0x01) !== 0 }
  set used(v: boolean) { this.flags = (this.flags & ~0x01) | (v ? 0x01 : 0) }

  get encrypted() { return (this.flags & 0x02) !== 0 }
  set encrypted(v: boolean) { this.flags = (this.flags & ~0x02) | (v ? 0x02 : 0) }

  get dataOffset() { return this.buf.readUInt32BE(this.base + IndexEntryView.DATA_OFFSET) }
  set dataOffset(v: number) { this.buf.writeUInt32BE(v >>> 0, this.base + IndexEntryView.DATA_OFFSET) }

  get dataLength() { return this.buf.readUInt16BE(this.base + IndexEntryView.LENGTH_OFFSET) }
  set dataLength(v: number) { this.buf.writeUInt16BE(v & 0xffff, this.base + IndexEntryView.LENGTH_OFFSET) }

  clearPad() { this.buf.writeUInt8(0, this.base + IndexEntryView.PAD_OFFSET) }

  static at(buffer: Buffer, slot: number): IndexEntryView {
    return new IndexEntryView(buffer, slot * INDEX_ENTRY_SIZE)
  }
}

class HeaderView {
  private static readonly VERSION_OFFSET = 4
  private static readonly HEADER_SIZE_OFFSET = 5
  private static readonly FLAGS_OFFSET = 9
  private static readonly ACTIVE_VERSION_OFFSET = 10
  private static readonly VERSIONS_COUNT_OFFSET = 11
  private static readonly INDEX_OFFSET_OFFSET = 16
  private static readonly INDEX_SIZE_OFFSET = 24
  private static readonly INDEX_USED_OFFSET = 32
  private static readonly DATA_START_OFFSET = 36
  private static readonly DATA_END_OFFSET = 44

  constructor(private buf: Buffer) { }

  get version() { return this.buf.readUInt8(HeaderView.VERSION_OFFSET) }
  set version(v: number) { this.buf.writeUInt8(v, HeaderView.VERSION_OFFSET) }

  get headerSize() { return this.buf.readUInt32BE(HeaderView.HEADER_SIZE_OFFSET) }
  set headerSize(v: number) { this.buf.writeUInt32BE(v, HeaderView.HEADER_SIZE_OFFSET) }

  get flags() { return this.buf.readUInt8(HeaderView.FLAGS_OFFSET) }
  set flags(v: number) { this.buf.writeUInt8(v, HeaderView.FLAGS_OFFSET) }

  get activeVersion() { return this.buf.readUInt8(HeaderView.ACTIVE_VERSION_OFFSET) }
  set activeVersion(v: number) { this.buf.writeUInt8(v, HeaderView.ACTIVE_VERSION_OFFSET) }

  get versionsCount() { return this.buf.readUInt8(HeaderView.VERSIONS_COUNT_OFFSET) }
  set versionsCount(v: number) { this.buf.writeUInt8(v, HeaderView.VERSIONS_COUNT_OFFSET) }

  get indexOffset() { return Number(this.buf.readBigUInt64BE(HeaderView.INDEX_OFFSET_OFFSET)) }
  set indexOffset(v: number) { this.buf.writeBigUInt64BE(BigInt(v), HeaderView.INDEX_OFFSET_OFFSET) }

  get indexSize() { return Number(this.buf.readBigUInt64BE(HeaderView.INDEX_SIZE_OFFSET)) }
  set indexSize(v: number) { this.buf.writeBigUInt64BE(BigInt(v), HeaderView.INDEX_SIZE_OFFSET) }

  get indexUsed() { return this.buf.readUInt32BE(HeaderView.INDEX_USED_OFFSET) }
  set indexUsed(v: number) { this.buf.writeUInt32BE(v, HeaderView.INDEX_USED_OFFSET) }

  get dataStart() { return Number(this.buf.readBigUInt64BE(HeaderView.DATA_START_OFFSET)) }
  set dataStart(v: number) { this.buf.writeBigUInt64BE(BigInt(v), HeaderView.DATA_START_OFFSET) }

  get dataEnd() { return Number(this.buf.readBigUInt64BE(HeaderView.DATA_END_OFFSET)) }
  set dataEnd(v: number) { this.buf.writeBigUInt64BE(BigInt(v), HeaderView.DATA_END_OFFSET) }

  readVersionName(i: number): string {
    const off = VERSION_TABLE_OFFSET + i * VERSION_ENTRY_SIZE
    return this.buf.subarray(off, off + VERSION_ENTRY_SIZE).toString('utf8').replace(/\0+$/, '')
  }

  writeVersionName(i: number, name: string) {
    const off = VERSION_TABLE_OFFSET + i * VERSION_ENTRY_SIZE
    this.buf.fill(0, off, off + VERSION_ENTRY_SIZE)
    const max = Math.min(VERSION_ENTRY_SIZE - 1, Buffer.byteLength(name))
    this.buf.write(name, off, max, 'utf8')
  }
}

export class FragmentStorage implements Storage {
  private readonly storageFilePath: string
  private fileHandle: fs.promises.FileHandle | null = null
  private headerBuf: Buffer | null = null
  private headerView: HeaderView | null = null
  private indexBuf: Buffer | null = null
  private idToSlot: Map<number, number> = new Map()
  private versions: string[] = []
  private encryptionEnabled = false
  private isCompacting = false
  private liveDataBytes = 0
  private freeExtents: Extent[] = []
  private headerDirty = false
  private pendingSync = false
  private lenBuf = Buffer.allocUnsafe(4)
  private scratch = Buffer.allocUnsafe(64 * 1024)

  constructor(storageFilePath: string) {
    this.storageFilePath = storageFilePath
  }

  isOpen(): boolean {
    return this.fileHandle !== null
  }

  async open(versions: string[] = ['public', 'private'], activeVersion: string = 'public'): Promise<void> {
    if (this.fileHandle) {
      if (!this.headerView) await this.loadMetadata()
      return
    }
    await fs.promises.mkdir(path.dirname(this.storageFilePath), { recursive: true })
    const exists = fs.existsSync(this.storageFilePath)
    if (!exists) {
      const handle = await fs.promises.open(this.storageFilePath, 'w+')
      this.fileHandle = handle
      await this.init(handle, versions, activeVersion)
    } else {
      this.fileHandle = await fs.promises.open(this.storageFilePath, 'r+')
      await this.loadMetadata()
    }
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close()
      this.fileHandle = null
      this.headerBuf = null
      this.headerView = null
      this.indexBuf = null
      this.versions = []
      this.idToSlot.clear()
      this.liveDataBytes = 0
      this.isCompacting = false
      this.freeExtents = []
      this.headerDirty = false
      this.pendingSync = false
    }
  }

  async upsertFragment(id: FragmentID, currentContent: string = '', version: string | null = null): Promise<void> {
    await this.ensureOpen()
    const hv = this.headerView!
    const idU16 = this.parseIdU16(id)
    const activeIndex = (version == null) ? hv.activeVersion : this.getVersionIndex(version)
    const slot = this.idToSlot.get(idU16)

    if(slot == null && version !== null) {
      throw new Error(`Fragment '${id}' does not exist`)
    }

    if (slot == null) {
      await this.ensureIndexCapacity(1)
      const contents = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER)
      contents[activeIndex] = Buffer.from(currentContent, 'utf8')
      await this.writeFragmentData(idU16, contents)
      return
    }

    // If fragment exists and no version is specified, do nothing (preserve existing content)
    if (version === null) {
      return
    }

    const existingContents = await this.readFragmentBuffersBySlot(slot)
    existingContents[activeIndex] = Buffer.from(currentContent, 'utf8')
    await this.writeFragmentData(idU16, existingContents)
  }

  async getFragmentContent(id: FragmentID, version: string): Promise<string | null> {
    await this.ensureOpen()
    const versionIndex = this.getVersionIndex(version)
    const idU16 = this.parseIdU16(id)
    const slot = this.idToSlot.get(idU16)
    if (slot == null) {
      return null
    }
    const contents = await this.readFragmentBuffersBySlot(slot)
    const buf = contents[versionIndex]
    return buf ? buf.toString('utf8') : ''
  }


  async getActiveVersion(): Promise<string> {
    await this.ensureOpen()
    return this.versions[this.headerView!.activeVersion]
  }

  async getAvailableVersions(): Promise<string[]> {
    await this.ensureOpen()
    return [...this.versions]
  }

  async setActiveVersion(versionName: string): Promise<void> {
    await this.ensureOpen()
    const idx = this.versions.indexOf(versionName)
    if (idx === -1) {
      throw new Error(`Version '${versionName}' does not exist.`)
    }
    this.headerView!.activeVersion = idx
    await this.persistHeader()
  }

  private async ensureOpen(): Promise<void> {
    if (!this.fileHandle || !this.headerView) {
      await this.open()
    }
  }

  private async init(
    handle: fs.promises.FileHandle,
    versions: string[],
    activeVersion: string
  ): Promise<void> {
    const versionSet = Array.from(new Set(versions))
    if (versionSet.length === 0) {
      throw new Error('At least one version must be provided when initializing storage.')
    }
    if (versionSet.length > MAX_VERSIONS) {
      throw new Error(`Storage header supports up to ${MAX_VERSIONS} versions.`)
    }
    for (const name of versionSet) {
      if (Buffer.byteLength(name, 'utf8') >= VERSION_ENTRY_SIZE) {
        throw new Error(`Version name '${name}' exceeds ${VERSION_ENTRY_SIZE - 1} bytes.`)
      }
    }
    this.headerBuf = Buffer.alloc(HEADER_SIZE, 0)
    this.headerView = new HeaderView(this.headerBuf)

    const hv = this.headerView
    const activeIndex = Math.max(0, versionSet.indexOf(activeVersion))
    MAGIC.copy(this.headerBuf, 0)
    hv.version = FORMAT_VERSION
    hv.headerSize = HEADER_SIZE
    hv.flags = this.encryptionEnabled ? HEADER_FLAG_ENCRYPTED : 0
    hv.activeVersion = activeIndex
    hv.versionsCount = versionSet.length
    hv.indexOffset = HEADER_SIZE
    hv.indexSize = INITIAL_INDEX_CAPACITY * INDEX_ENTRY_SIZE
    hv.indexUsed = 0
    hv.dataStart = HEADER_SIZE + hv.indexSize
    hv.dataEnd = hv.dataStart
    
    for (let i = 0; i < versionSet.length; i++) {
      hv.writeVersionName(i, versionSet[i])
    }
    await handle.write(this.headerBuf, 0, HEADER_SIZE, 0)
    this.indexBuf = Buffer.alloc(hv.indexSize, 0)
    await handle.write(this.indexBuf, 0, hv.indexSize, hv.indexOffset)
    await handle.sync()
    this.versions = versionSet
    this.idToSlot.clear()
    this.liveDataBytes = 0
    this.freeExtents = []
    this.headerDirty = false
    this.pendingSync = false
  }

  private async loadMetadata(): Promise<void> {
    const handle = this.fileHandle!
    this.headerBuf = Buffer.alloc(HEADER_SIZE)
    await handle.read(this.headerBuf, 0, HEADER_SIZE, 0)
    if (!this.headerBuf.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid fragments storage format magic.')
    } 
    this.headerView = new HeaderView(this.headerBuf)
    const hv = this.headerView
    if (hv.version !== FORMAT_VERSION) {
      throw new Error(`Unsupported storage format version: ${hv.version}`)
    } 
    if (hv.headerSize !== HEADER_SIZE) {
      throw new Error(`Unexpected header size ${hv.headerSize}, expected ${HEADER_SIZE}.`)
    }
    if (hv.versionsCount > MAX_VERSIONS) {
      throw new Error(`Stored versions count ${hv.versionsCount} exceeds supported limit ${MAX_VERSIONS}.`)
    }

    this.encryptionEnabled = (hv.flags & HEADER_FLAG_ENCRYPTED) !== 0
    this.versions = []
    for (let i = 0; i < hv.versionsCount; i++) {
      this.versions.push(hv.readVersionName(i))
    }
    this.indexBuf = Buffer.alloc(hv.indexSize)
    const bytesToRead = hv.indexUsed * INDEX_ENTRY_SIZE
    if (bytesToRead > 0) {
      await handle.read(this.indexBuf, 0, bytesToRead, hv.indexOffset)
    }
    this.idToSlot.clear()
    const usedExtents: Extent[] = []
    for (let slot = 0; slot < hv.indexUsed; slot++) {
      const view = IndexEntryView.at(this.indexBuf, slot)
      if (!view.used) {
        continue
      }
      this.idToSlot.set(view.id, slot)
      usedExtents.push({ offset: view.dataOffset, length: view.dataLength })
    }
    this.rebuildFreeExtents(usedExtents)
    this.headerDirty = false
    this.pendingSync = false
  }

  private async persistHeader(): Promise<void> {
    const handle = await this.getFileHandle()
    await handle.write(this.headerBuf!, 0, HEADER_SIZE, 0)
    this.headerDirty = false
  }

  private getIndexCapacity(): number {
    const hv = this.headerView!
    return Math.floor(hv.indexSize / INDEX_ENTRY_SIZE)
  }

  private async ensureIndexCapacity(additional: number): Promise<void> {
    const hv = this.headerView!
    const capacity = this.getIndexCapacity()
    if (hv.indexUsed + additional <= capacity) {
      return
    }

    let newCapacity = capacity === 0 ? INITIAL_INDEX_CAPACITY : capacity
    while (hv.indexUsed + additional > newCapacity) {
      newCapacity *= 2
    } 
    await this.expandIndex(newCapacity)
  }

  private async expandIndex(newCapacity: number): Promise<void> {
    const handle = await this.getFileHandle()
    const hv = this.headerView!
    const currentCapacity = this.getIndexCapacity()
    if (newCapacity <= currentCapacity) {
      return
    }
    const oldIndexSize = hv.indexSize
    const newIndexSize = newCapacity * INDEX_ENTRY_SIZE
    const growth = newIndexSize - oldIndexSize
    const oldDataStart = hv.dataStart
    const oldDataEnd = hv.dataEnd
    const newDataStart = hv.indexOffset + newIndexSize
    const newDataEnd = oldDataEnd + growth
    const dataLength = oldDataEnd - oldDataStart
    if (growth > 0 && dataLength > 0) {
      const chunkSize = 1024 * 1024
      let remaining = dataLength
      while (remaining > 0) {
        const step = Math.min(chunkSize, remaining)
        const readPosition = oldDataStart + remaining - step
        const writePosition = newDataStart + remaining - step
        const tmp = Buffer.allocUnsafe(step)
        await handle.read(tmp, 0, step, readPosition)
        await handle.write(tmp, 0, step, writePosition)
        remaining -= step
      }
    }
    const newIdx = Buffer.alloc(newIndexSize, 0)
    for (let slot = 0; slot < hv.indexUsed; slot++) {
      const oldV = IndexEntryView.at(this.indexBuf!, slot)
      if (!oldV.used) {
        continue
      }
      const v = IndexEntryView.at(newIdx, slot)
      v.id = oldV.id
      v.flags = oldV.flags
      v.dataOffset = oldV.dataOffset + growth
      v.dataLength = oldV.dataLength
      v.clearPad()
    }
    await handle.write(newIdx, 0, newIndexSize, hv.indexOffset)
    hv.indexSize = newIndexSize
    hv.dataStart = newDataStart
    hv.dataEnd = newDataEnd
    this.indexBuf = newIdx
    this.rebuildFreeExtents()
    await this.persistHeader()
    await handle.sync()
  }

  private ensureScratch(size: number) {
    if (this.scratch.length >= size) {
      return
    }
    const next = Math.max(size, Math.floor(this.scratch.length * 1.5))
    const nb = Buffer.allocUnsafe(next)
    this.scratch = nb
  }

  private rebuildFreeExtents(knownUsed: Extent[] = []): void {
    const hv = this.headerView
    if (!hv) {
      this.freeExtents = []
      this.liveDataBytes = 0
      return
    }
    const used = knownUsed.length > 0 ? [...knownUsed] : this.collectUsedExtents()
    used.sort((a, b) => a.offset - b.offset)
    this.freeExtents = []
    this.liveDataBytes = 0
    let cursor = hv.dataStart
    for (const ext of used) {
      if (ext.length <= 0) {
        continue
      }
      this.liveDataBytes += ext.length
      const start = Math.max(ext.offset, hv.dataStart)
      const end = Math.min(ext.offset + ext.length, hv.dataEnd)
      if (start > cursor) {
        this.freeExtents.push({ offset: cursor, length: start - cursor })
      }
      if (end > cursor) {
        cursor = end
      }
    }
    if (cursor < hv.dataEnd) {
      this.freeExtents.push({ offset: cursor, length: hv.dataEnd - cursor })
    }
  }

  private collectUsedExtents(): Extent[] {
    const hv = this.headerView
    if (!hv || !this.indexBuf) {
      return []
    }
    const result: Extent[] = []
    for (let slot = 0; slot < hv.indexUsed; slot++) {
      const view = IndexEntryView.at(this.indexBuf, slot)
      if (!view.used) {
        continue
      }
      result.push({ offset: view.dataOffset, length: view.dataLength })
    }
    return result
  }

  private allocateExtent(requiredLength: number): Extent | null {
    if (requiredLength <= 0) {
      return null
    }
    for (let i = 0; i < this.freeExtents.length; i++) {
      const ext = this.freeExtents[i]
      if (ext.length < requiredLength) {
        continue
      }
      const allocation = { offset: ext.offset, length: requiredLength }
      if (ext.length === requiredLength) {
        this.freeExtents.splice(i, 1)
      } else {
        this.freeExtents[i] = { offset: ext.offset + requiredLength, length: ext.length - requiredLength }
      }
      return allocation
    }
    return null
  }

  private addFreeExtent(offset: number, length: number): void {
    const hv = this.headerView
    if (!hv || length <= 0) {
      return
    }
    let start = Math.max(offset, hv.dataStart)
    let end = Math.min(offset + length, hv.dataEnd)
    if (end <= start) {
      return
    }
    const merged: Extent[] = []
    let mergedStart = start
    let mergedEnd = end
    let inserted = false
    for (const ext of this.freeExtents) {
      const extEnd = ext.offset + ext.length
      if (extEnd < mergedStart) {
        merged.push(ext)
        continue
      }
      if (ext.offset > mergedEnd) {
        if (!inserted) {
          merged.push({ offset: mergedStart, length: mergedEnd - mergedStart })
          inserted = true
        }
        merged.push(ext)
        continue
      }
      mergedStart = Math.min(mergedStart, ext.offset)
      mergedEnd = Math.max(mergedEnd, extEnd)
    }
    if (!inserted) {
      merged.push({ offset: mergedStart, length: mergedEnd - mergedStart })
    }
    this.freeExtents = merged
  }

  private async trimDataEnd(): Promise<boolean> {
    const hv = this.headerView
    if (!hv) {
      return false
    }
    let trimmed = false
    while (this.freeExtents.length > 0) {
      const last = this.freeExtents[this.freeExtents.length - 1]
      if (last.offset + last.length !== hv.dataEnd) {
        break
      }
      trimmed = true
      hv.dataEnd = Math.max(hv.dataStart, last.offset)
      this.freeExtents.pop()
    }
    if (trimmed) {
      const handle = await this.getFileHandle()
      await handle.truncate(hv.dataEnd)
    }
    return trimmed
  }

  private findRelocationCandidate(): number | null {
    const hv = this.headerView
    if (!hv || !this.indexBuf) {
      return null
    }
    for (const target of this.freeExtents) {
      const slot = this.findSlotForExtent(target, hv)
      if (slot != null) {
        return slot
      }
    }
    return null
  }

  private findSlotForExtent(target: Extent, hv: HeaderView): number | null {
    const maxBytes = Math.min(target.length, INCREMENTAL_COMPACTION_MAX_BYTES)
    if (maxBytes <= 0) {
      return null
    }
    let bestSlot = -1
    let bestOffset = -1
    for (let slot = 0; slot < hv.indexUsed; slot++) {
      const view = IndexEntryView.at(this.indexBuf!, slot)
      if (!view.used) {
        continue
      }
      if (view.dataOffset <= target.offset) {
        continue
      }
      if (view.dataLength > target.length || view.dataLength > maxBytes) {
        continue
      }
      if (view.dataOffset > bestOffset) {
        bestSlot = slot
        bestOffset = view.dataOffset
      }
    }
    return bestSlot === -1 ? null : bestSlot
  }

  private async flushPendingWrites(): Promise<void> {
    if (!this.pendingSync) {
      return
    }
    if (this.headerDirty) {
      await this.persistHeader()
    }
    const handle = await this.getFileHandle()
    await handle.datasync()
    this.pendingSync = false
  }

  private async readFragmentBuffersBySlot(slot: number): Promise<Buffer[]> {
    const handle = await this.getFileHandle()
    const view = IndexEntryView.at(this.indexBuf!, slot)
    if (view.dataLength <= 4) {
      throw new Error('Corrupted fragment payload: invalid chunk length.')
    }
    const lenBuf = this.lenBuf
    await handle.read(lenBuf, 0, 4, view.dataOffset)
    const payloadLength = lenBuf.readUInt32BE(0)
    if (payloadLength === 0) {
      return new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER)
    }
    if (payloadLength + 4 !== view.dataLength) {
      throw new Error('Corrupted fragment payload: mismatched length.')
    }
    this.ensureScratch(payloadLength)
    await handle.read(this.scratch, 0, payloadLength, view.dataOffset + 4)
    return this.decodeFragmentContents(this.scratch.subarray(0, payloadLength))
  }

  private alignContents(contents: Buffer[]): Buffer[] {
    const result = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER)
    for (let i = 0; i < Math.min(contents.length, this.versions.length); i++) {
      result[i] = contents[i] ?? EMPTY_BUFFER
    }
    return result
  }

  private encodeFragmentContents(contents: Buffer[]): Buffer {
    const entries: { versionIndex: number; data: Buffer }[] = []
    let totalDataLength = 0
    for (let i = 0; i < contents.length; i++) {
      const value = contents[i]
      if (!value || value.length === 0) continue
      entries.push({ versionIndex: i, data: value })
      totalDataLength += value.length
    }
    const entryCount = entries.length
    const metadataSize = entryCount * (1 + 4)
    const payloadLen = 2 + metadataSize + totalDataLength
    if (payloadLen + 4 > 0xffff) {
      throw new Error(`Fragment payload too large (${payloadLen} bytes payload, ${payloadLen + 4} chunk).`)
    }
    const buffer = Buffer.allocUnsafe(payloadLen > 0 ? payloadLen : 2)
    buffer.writeUInt16BE(entryCount, 0)
    if (entryCount === 0) return buffer.subarray(0, 2)
    let metaOffset = 2
    let dataOffset = 2 + metadataSize
    for (const entry of entries) {
      buffer.writeUInt8(entry.versionIndex, metaOffset)
      metaOffset += 1
      buffer.writeUInt32BE(entry.data.length, metaOffset)
      metaOffset += 4
      entry.data.copy(buffer, dataOffset)
      dataOffset += entry.data.length
    }
    return buffer
  }

  private decodeFragmentContents(buffer: Buffer): Buffer[] {
    if (buffer.length === 0) {
      return new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER)
    }
    if (buffer.length < 2) {
      throw new Error('Corrupted fragment payload: missing entry count.')
    }
    const entryCount = buffer.readUInt16BE(0)
    const metadataSize = entryCount * (1 + 4)
    const metadataEnd = 2 + metadataSize
    if (buffer.length < metadataEnd) {
      throw new Error('Corrupted fragment payload: truncated metadata.')
    }
    const contents = new Array<Buffer>(this.versions.length).fill(EMPTY_BUFFER)
    let metaOffset = 2
    let dataOffset = metadataEnd
    for (let i = 0; i < entryCount; i++) {
      const versionIndex = buffer.readUInt8(metaOffset)
      metaOffset += 1
      const len = buffer.readUInt32BE(metaOffset)
      metaOffset += 4
      const end = dataOffset + len
      if (end > buffer.length) {
        throw new Error('Corrupted fragment payload: data exceeds buffer bounds.')
      }
      if (versionIndex < contents.length) {
        contents[versionIndex] = len > 0 ? buffer.subarray(dataOffset, end) : EMPTY_BUFFER
      }
      dataOffset = end
    }
    return contents
  }

  private async writeFragmentData(
    idU16: number,
    versionContents: Buffer[],
    skipCompaction = false,
    forceMove = false,
    shouldFlush = true
  ): Promise<void> {
    const handle = await this.getFileHandle()
    const hv = this.headerView!
    const aligned = this.alignContents(versionContents)
    const payload = this.encodeFragmentContents(aligned)
    this.lenBuf.writeUInt32BE(payload.length, 0)
    const chunkLength = 4 + payload.length

    const prevSlot = this.idToSlot.get(idU16)
    const prevView = prevSlot != null ? IndexEntryView.at(this.indexBuf!, prevSlot) : null
    const prevLength = prevView ? prevView.dataLength : 0

    let writeOffset: number
    let reusedExisting = false
    let leftoverFromInPlace = 0

    if (!forceMove && prevView && prevLength >= chunkLength) {
      writeOffset = prevView.dataOffset
      reusedExisting = true
      leftoverFromInPlace = prevLength - chunkLength
    } else {
      const allocation = this.allocateExtent(chunkLength)
      if (allocation) {
        writeOffset = allocation.offset
      } else {
        writeOffset = hv.dataEnd
        hv.dataEnd = writeOffset + chunkLength
      }
    }

    await handle.writev([this.lenBuf, payload], writeOffset)

    if (!reusedExisting && prevView) {
      this.addFreeExtent(prevView.dataOffset, prevView.dataLength)
    }
    if (leftoverFromInPlace > 0) {
      this.addFreeExtent(writeOffset + chunkLength, leftoverFromInPlace)
    }

    let slot = prevSlot
    if (slot == null) {
      slot = hv.indexUsed
      hv.indexUsed++
      this.idToSlot.set(idU16, slot)
    }

    const view = IndexEntryView.at(this.indexBuf!, slot)
    view.id = idU16
    view.used = true
    view.dataOffset = writeOffset
    view.dataLength = chunkLength
    view.clearPad()

    this.liveDataBytes += chunkLength - prevLength

    const indexEntryOffset = hv.indexOffset + slot * INDEX_ENTRY_SIZE
    await handle.write(this.indexBuf!, slot * INDEX_ENTRY_SIZE, INDEX_ENTRY_SIZE, indexEntryOffset)

    await this.trimDataEnd()
    this.headerDirty = true
    this.pendingSync = true
    if (!skipCompaction) {
      await this.maybeCompactStorage()
    }
    if (shouldFlush) {
      await this.flushPendingWrites()
    }
  }

  private calculateUsedDataBytes(): number {
    return this.liveDataBytes
  }

  private async maybeCompactStorage(): Promise<void> {
    const hv = this.headerView
    if (!hv || this.isCompacting) {
      return
    }
    if (this.freeExtents.length === 0) {
      return
    }
    const totalSpan = hv.dataEnd - hv.dataStart
    if (totalSpan <= 0) {
      return
    }
    const usedBytes = this.calculateUsedDataBytes()
    if (usedBytes === 0) {
      const trimmed = await this.trimDataEnd()
      if (trimmed) {
        await this.persistHeader()
        const handle = await this.getFileHandle()
        await handle.sync()
      }
      return
    }
    const tail = this.freeExtents[this.freeExtents.length - 1]
    const tailTouchesEnd = tail && (tail.offset + tail.length === hv.dataEnd)
    const density = usedBytes / totalSpan
    const densityLow = totalSpan >= COMPACTION_MIN_BYTES && hv.indexUsed >= COMPACTION_MIN_FRAGMENTS && density < COMPACTION_DENSITY_THRESHOLD
    if (!tailTouchesEnd && !densityLow) {
      return
    }
    await this.compactStorage()
  }

  private async compactStorage(): Promise<void> {
    if (this.isCompacting) { 
      return
    }
    const hv = this.headerView
    if (!hv || this.freeExtents.length === 0) {
      return
    }
    this.isCompacting = true
    try {
      const trimmed = await this.trimDataEnd()
      if (this.freeExtents.length === 0) {
        if (trimmed) {
          await this.persistHeader()
          const handle = await this.getFileHandle()
          await handle.sync()
        }
        return
      }
      const candidateSlot = this.findRelocationCandidate()
      if (candidateSlot == null) {
        if (trimmed) {
          await this.persistHeader()
          const handle = await this.getFileHandle()
          await handle.sync()
        }
        return
      }
      const view = IndexEntryView.at(this.indexBuf!, candidateSlot)
      const contents = await this.readFragmentBuffersBySlot(candidateSlot)
      await this.writeFragmentData(view.id, contents, true, true, false)
    } finally {
      this.isCompacting = false
    }
  }

  private parseIdU16(id: FragmentID): number {
    const s = id as unknown as string
    if (s.length === 4) {
      return parseInt(s, 16) & 0xffff
    }
    const b = Buffer.from(s, 'hex')
    if (b.length !== FRAGMENT_ID_SIZE) {
       throw new Error(`Invalid FragmentID size: expected ${FRAGMENT_ID_SIZE} bytes, got ${b.length}`)
    }
    return b.readUInt16BE(0)
  }

  private getVersionIndex(version: string): number {
    const idx = this.versions.indexOf(version)
    if (idx === -1) {
      throw new Error(`Version '${version}' does not exist.`)
    }
    return idx
  }

  private async getFileHandle(): Promise<fs.promises.FileHandle> {
    if (!this.fileHandle) {
      await this.open()
    }
    if (!this.fileHandle) {
      throw new Error('Failed to obtain file handle.')
    }
    return this.fileHandle
  }
}
