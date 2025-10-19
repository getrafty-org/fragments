#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { FragmentStorage } from './index'
import { FragmentID } from 'fgmpack-protocol'
import {
  Plot,
  Metrics,
  resolveBenchmarkConfig,
  formatDuration,
  timeOperation,
} from './bench/core'

class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private size: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;

  constructor(size: number) {
    this.size = size;
    this.buffer = new Array(size).fill(undefined);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.size;
    if (this.count === this.size) {
      this.tail = (this.tail + 1) % this.size;
    } else {
      this.count++;
    }
  }

  isEmpty(): boolean {
    return this.count === 0;
  }

  get length(): number {
    return this.count;
  }

  random(): T | undefined {
    if (this.count === 0) return undefined;
    const randomIndex = (this.tail + Math.floor(Math.random() * this.count)) % this.size;
    return this.buffer[randomIndex];
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    const index = (this.head - 1 + this.size) % this.size;
    return this.buffer[index];
  }
}

function pickOperation(r: number = 0.3, w: number = 0.5, u: number = 0.2): 'read' | 'write' | 'update' {
  const total = r + w + u
  if (total <= 0) return 'write'
  const rnd = Math.random() * total
  let cumulative = r
  if (rnd < cumulative) return 'read'
  cumulative += w
  if (rnd < cumulative) return 'write'
  return 'update'
}


function generateRandom2BytesHex(): FragmentID {
  const random = Math.floor(Math.random() * 65536);
  return random.toString(16).padStart(4, '0') as FragmentID;
}

function generateRandomXBytes(): string {
  const len = Math.floor(Math.random() * 10980) + 10;
  return Array.from({ length: len }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}


async function runBench(
  storageFactory: () => FragmentStorage,
  metrics: Metrics,
  display: Plot
): Promise<void> {
  const storage = storageFactory()
  await storage.open(['public', 'private'], 'public')
  const idBuf = new CircularBuffer<FragmentID>(100)

  try {
    while (display.isRunning()) {
      let op = pickOperation()
      if (op !== 'write' && idBuf.isEmpty()) {
        op = 'write'
      }

      let latency = 0
      switch (op) {
        case 'read': {
          const id = idBuf.random()
          if (!id) {
            continue
          }
          const version = Math.random() < 0.5 ? 'public' : 'private'
          latency = await timeOperation(async () => {
            await storage.getFragmentContent(id, version)
          })
          break
        }
        case 'write': {
          const id = generateRandom2BytesHex()
          const publicContent = generateRandomXBytes()
          const privateContent = generateRandomXBytes()
          latency = await timeOperation(async () => {
            await storage.upsertFragment(id, publicContent)
            await storage.upsertFragment(id, privateContent, 'private')
          })
          idBuf.push(id)
          break
        }
        case 'update': {
          const id = idBuf.random()
          if (!id) {
            continue
          }
          const version = Math.random() < 0.5 ? 'public' : 'private'
          const content = generateRandomXBytes()
          latency = await timeOperation(async () => {
            await storage.upsertFragment(id, content, version)
          })
          break
        }
      }

      metrics.addSample(`${op}.latency`, latency)
      metrics.addSample(`${op}.count`, 1)

      try {
        const stats = fs.statSync((storage as any).storageFilePath)
        metrics.addSample('file.size', stats.size)
      } catch (error) {
        console.error(error)
      }

    }
  } finally {
    await storage.close()
  }
}

async function main(): Promise<void> {
  const tempFile = path.join(os.tmpdir(), `${Date.now()}.db`)
  const conf = resolveBenchmarkConfig({
    metrics: [
      { key: 'write.latency', label: 'write latency', unit: 'time' },
      { key: 'write.count', label: 'write throughput', unit: 'count' },
      { key: 'update.latency', label: 'update latency', unit: 'time' },
      { key: 'update.count', label: 'update throughput', unit: 'count' },
      { key: 'read.latency', label: 'read latency', unit: 'time' },
      { key: 'read.count', label: 'read throughput', unit: 'count' },
      { key: 'file.size', label: 'file size', unit: 'size' },
    ],
  });

  const header = () => [
    `File: ${tempFile}`,
    `Window: ${formatDuration(conf.windowSizeMs)}`
  ]

  const metrics = new Metrics(conf);
  const display = new Plot(conf, { header })

  try {
    await display.start(metrics)
    await runBench(() => new FragmentStorage(tempFile), metrics, display)
  } finally {
    display.stop()
    try {
      fs.unlinkSync(tempFile)
    } catch (error) {
      console.error(error)
    }
  }

}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
