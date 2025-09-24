#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');
const { FragmentStorage } = require('../language-server/dist/src/storage.js');

const METRIC_KEYS = ['update', 'readPublic', 'readPrivate'];
const OPERATION_LABELS = {
  update: 'update',
  readPublic: 'read-public',
  readPrivate: 'read-private'
};

async function timeOperation(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function percentile(sortedSamples, q) {
  if (sortedSamples.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * q) - 1)
  );
  return sortedSamples[index];
}

function computeStats(samples) {
  if (samples.length === 0) {
    return { avg: 0, p50: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, value) => acc + value, 0);
  return {
    avg: sum / samples.length,
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99)
  };
}

function printBenchmark(label, result) {
  const sizeKb = (result.size / 1024).toFixed(1);
  console.log(`${label} size ${sizeKb}KB`);
  for (const key of METRIC_KEYS) {
    const stats = result.metrics[key];
    if (!stats) {
      continue;
    }
    const operationLabel = OPERATION_LABELS[key].padEnd(12, ' ');
    console.log(
      `  ${operationLabel}avg ${stats.avg.toFixed(3)}ms | p50 ${stats.p50.toFixed(3)}ms | p99 ${stats.p99.toFixed(3)}ms`
    );
  }
}

async function benchmark(fragments, storageFactory) {
  const storage = storageFactory();
  await storage.open(['public', 'private'], 'public');

  const records = Array.from({ length: fragments }, (_, idx) => {
    const hexId = idx.toString(16).padStart(4, '0');
    return {
      id: hexId,
      publicContent: `public content ${idx}`,
      privateContent: `private content for fragment ${idx} - more detailed implementation`
    };
  });

  const updateSamples = [];
  const readPublicSamples = [];
  const readPrivateSamples = [];

  // Warm up and populate storage
  for (const record of records.slice(0, 10)) {
    await storage.ensureFragment(record.id, record.publicContent);
    await storage.updateFragment(record.id, 'public', record.publicContent);
    await storage.updateFragment(record.id, 'private', record.privateContent);
  }

  // Update benchmark
  for (const record of records) {
    await storage.ensureFragment(record.id, record.publicContent);

    const updateTime = await timeOperation(async () => {
      await storage.updateFragment(record.id, 'public', record.publicContent);
      await storage.updateFragment(record.id, 'private', record.privateContent);
    });
    updateSamples.push(updateTime);
  }

  // Read benchmarks
  for (const record of records) {
    const readPublicTime = await timeOperation(async () => {
      await storage.getFragmentContent(record.id, 'public');
    });
    readPublicSamples.push(readPublicTime);

    const readPrivateTime = await timeOperation(async () => {
      await storage.getFragmentContent(record.id, 'private');
    });
    readPrivateSamples.push(readPrivateTime);
  }

  await storage.close();

  const stats = fs.statSync(storage.storageFilePath);
  return {
    size: stats.size,
    metrics: {
      update: computeStats(updateSamples),
      readPublic: computeStats(readPublicSamples),
      readPrivate: computeStats(readPrivateSamples)
    }
  };
}

async function runBenchmarks() {
  const fragmentCounts = [10, 50, 100, 500];

  console.log('Fragment Storage Performance Benchmark');
  console.log('=====================================\n');

  for (const count of fragmentCounts) {
    const tempFile = path.join(os.tmpdir(), `fragments-bench-${count}-${Date.now()}.db`);

    const result = await benchmark(count, () => new FragmentStorage(tempFile));
    printBenchmark(`${count} fragments`, result);

    // Cleanup
    try {
      fs.unlinkSync(tempFile);
    } catch (err) {
      // Ignore cleanup errors
    }

    console.log('');
  }
}

if (require.main === module) {
  runBenchmarks().catch(console.error);
}

module.exports = { benchmark, runBenchmarks };