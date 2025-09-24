import { afterEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FragmentStorage } from '../storage';
import { FragmentId, isValidFragmentId, createFragmentId } from 'fgmpack-protocol';


type SeedFragment = {
  id: string;
  public?: string;
  private?: string;
};

type StorageOptions = {
  versions?: string[];
  activeVersion?: string;
  encryptionKey?: string;
  skipOpen?: boolean;
  seedFragments?: SeedFragment[];
};

type StorageContext = {
  storage: FragmentStorage;
  storagePath: string;
  tmpDir: string;
  cleanup: () => Promise<void>;
};

const activeContexts: StorageContext[] = [];

async function createStorageContext(options: StorageOptions = {}): Promise<StorageContext> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fragments-storage-test-'));
  const storagePath = path.join(tmpDir, 'storage.bin');
  const storage = new FragmentStorage(storagePath, options.encryptionKey);

  if (!options.skipOpen) {
    await storage.open(options.versions, options.activeVersion);
    if (options.seedFragments) {
      for (const fragment of options.seedFragments) {
        const fragmentId = fragment.id as FragmentId;
        await storage.ensureFragment(fragmentId, fragment.public ?? '');
        if (fragment.private !== undefined) {
          await storage.updateFragment(fragmentId, 'private', fragment.private);
        }
      }
    }
  }

  return {
    storage,
    storagePath,
    tmpDir,
    cleanup: async () => {
      try {
        await storage.close();
      } catch (error) {
        // ignore cleanup errors
      }
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function newStorageContext(options?: StorageOptions): Promise<StorageContext> {
  const context = await createStorageContext(options);
  activeContexts.push(context);
  return context;
}

afterEach(async () => {
  while (activeContexts.length > 0) {
    const context = activeContexts.pop();
    if (context) {
      await context.cleanup();
    }
  }
});


describe('FragmentStorage basic behaviour', () => {
  test('ensures fragments and updates version contents', async () => {
    const { storage } = await newStorageContext();

    const id: FragmentId = 'a1b2';
    await storage.ensureFragment(id, 'initial public');
    expect(await storage.getFragmentContent(id, 'public')).toBe('initial public');
    expect(await storage.getFragmentContent(id, 'private')).toBe('');

    await storage.updateFragment(id, 'private', 'secret value');
    expect(await storage.getFragmentContent(id, 'private')).toBe('secret value');
  });

  test('ensuring the same fragment twice leaves the original content intact', async () => {
    const { storage } = await newStorageContext();

    const id: FragmentId = 'c3d4';
    await storage.ensureFragment(id, 'original body');
    await storage.ensureFragment(id, 'ignored body');

    expect(await storage.getFragmentContent(id, 'public')).toBe('original body');
  });

  test('update fragment fails for non-existent fragment', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.updateFragment('ffff' as FragmentId, 'public', 'auto body')).rejects.toThrow("Fragment 'ffff' does not exist");
  });

  test('persists fragment data across reopen', async () => {
    const context = await newStorageContext();
    const { storage, storagePath } = context;

    const id = createFragmentId('1234');
    await storage.ensureFragment(id, 'public body');
    await storage.updateFragment(id, 'private', 'private body');
    await storage.close();

    const reopen = new FragmentStorage(storagePath);
    try {
      await reopen.open();
      expect(await reopen.getFragmentContent(id, 'public')).toBe('public body');
      expect(await reopen.getFragmentContent(id, 'private')).toBe('private body');
    } finally {
      await reopen.close();
    }
  });

  test('tracks available versions and active selection across reopen', async () => {
    const context = await newStorageContext();
    const { storage, storagePath } = context;

    expect(await storage.getAvailableVersions()).toEqual(['public', 'private']);
    expect(await storage.getActiveVersion()).toBe('public');

    await storage.switchVersion('private');
    expect(await storage.getActiveVersion()).toBe('private');
    await storage.close();

    const reopen = new FragmentStorage(storagePath);
    try {
      await reopen.open();
      expect(await reopen.getActiveVersion()).toBe('private');
    } finally {
      await reopen.close();
    }
  });

  test('returns null when requesting an unknown fragment', async () => {
    const { storage } = await newStorageContext();

    expect(await storage.getFragmentContent('0000' as FragmentId, 'public')).toBeNull();
  });

  test('reflects open state when closing and reopening', async () => {
    const { storage } = await newStorageContext();

    expect(storage.isOpen()).toBe(true);
    await storage.close();
    expect(storage.isOpen()).toBe(false);

    await storage.open();
    expect(storage.isOpen()).toBe(true);
  });

  test('throws when switching to an unknown version', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.switchVersion('non-existent')).rejects.toThrow("Version 'non-existent' does not exist.");
  });

  test('rejects updates to an unknown version', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.updateFragment('fffe' as FragmentId, 'draft', 'value')).rejects.toThrow("Version 'draft' does not exist.");
  });

  test('rejects reads for an unknown version', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.getFragmentContent('fffd' as FragmentId, 'draft')).rejects.toThrow("Version 'draft' does not exist.");
  });

  test('open rejects when no versions are provided', async () => {
    const context = await newStorageContext({ skipOpen: true });
    await expect(context.storage.open([], 'public')).rejects.toThrow('At least one version must be provided when initializing storage.');
  });

  test('open rejects when too many versions are provided', async () => {
    const context = await newStorageContext({ skipOpen: true });
    const versions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
    await expect(context.storage.open(versions, 'v1')).rejects.toThrow('Storage header supports up to 6 versions.');
  });

  test('open rejects when version name exceeds the allowed length', async () => {
    const context = await newStorageContext({ skipOpen: true });
    const versions = ['public', 'x'.repeat(40)];
    await expect(context.storage.open(versions, 'public')).rejects.toThrow(/Version name/);
  });

  test('handles 2-byte hex fragment IDs', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('abcd');
    await storage.ensureFragment(id, 'test content');
    expect(await storage.getFragmentContent(id, 'public')).toBe('test content');

    // Fragment should persist with 2-byte hex ID
    await storage.updateFragment(id, 'private', 'private content');
    expect(await storage.getFragmentContent(id, 'private')).toBe('private content');
  });

  test('handles various fragment ID formats', async () => {
    const { storage } = await newStorageContext();

    // Test different valid 4-char hex IDs
    const testIds = ['0000', 'ffff', 'a1b2', '9999'];

    for (const idString of testIds) {
      const id = createFragmentId(idString);
      await storage.ensureFragment(id, `content for ${id}`);
      expect(await storage.getFragmentContent(id, 'public')).toBe(`content for ${id}`);
    }
  });

  test('auto opens on first read request', async () => {
    const context = await newStorageContext({ skipOpen: true });
    expect(await context.storage.getFragmentContent(createFragmentId('0000'), 'public')).toBeNull();
  });

  test('validates fragment ID format with type safety', async () => {
    // Valid fragment IDs
    expect(isValidFragmentId('0000')).toBe(true);
    expect(isValidFragmentId('abcd')).toBe(true);
    expect(isValidFragmentId('ffff')).toBe(true);

    // Invalid fragment IDs
    expect(isValidFragmentId('123')).toBe(false);  // Too short
    expect(isValidFragmentId('12345')).toBe(false); // Too long
    expect(isValidFragmentId('gggg')).toBe(false);  // Invalid hex
    expect(isValidFragmentId('ABCD')).toBe(false);  // Uppercase not allowed

    // createFragmentId should throw for invalid IDs
    expect(() => createFragmentId('invalid')).toThrow('Invalid fragment ID: invalid. Must be 4-character hex string.');

    // Valid creation should work
    const validId = createFragmentId('1234');
    expect(validId).toBe('1234');
  });

  test('enforces encryption key requirements end-to-end', async () => {
    const encryptedContext = await newStorageContext({ encryptionKey: 'test-secret' });
    const { storagePath } = encryptedContext;
    const originalKey = process.env.FRAGMENTS_ENCRYPTION_KEY;

    try {
      const id = createFragmentId('9999');
      await encryptedContext.storage.ensureFragment(id, 'public text');
      await encryptedContext.storage.updateFragment(id, 'private', 'encrypted text');
      await encryptedContext.storage.close();

      delete process.env.FRAGMENTS_ENCRYPTION_KEY;
      const withoutKey = new FragmentStorage(storagePath);
      await expect(withoutKey.open()).rejects.toThrow('Storage requires encryption key');

      process.env.FRAGMENTS_ENCRYPTION_KEY = 'test-secret';
      const reopen = new FragmentStorage(storagePath);
      await reopen.open();
      expect(await reopen.getFragmentContent(id, 'private')).toBe('encrypted text');
      await reopen.close();
    } finally {
      if (originalKey === undefined) {
        delete process.env.FRAGMENTS_ENCRYPTION_KEY;
      } else {
        process.env.FRAGMENTS_ENCRYPTION_KEY = originalKey;
      }
    }
  });
});

describe('FragmentStorage resilience', () => {
  test('handles corrupted storage files gracefully', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '1111', public: 'data' }] });
    await context.storage.close();

    // Corrupt the file with random data
    await fs.promises.writeFile(context.storagePath, Buffer.from('corrupted data'));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('handles truncated storage files', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '2222', public: 'data' }] });
    await context.storage.close();

    // Truncate the file
    await fs.promises.writeFile(context.storagePath, Buffer.alloc(10));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('handles empty storage files', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '3333', public: 'data' }] });
    await context.storage.close();

    // Empty the file
    await fs.promises.writeFile(context.storagePath, Buffer.alloc(0));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('recovers gracefully from missing storage file', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fragments-test-'));
    const missingPath = path.join(tmpDir, 'missing.bin');

    try {
      const storage = new FragmentStorage(missingPath);
      await storage.open(); // Should create new file

      const id = createFragmentId('1234');
      await storage.ensureFragment(id, 'content');
      expect(await storage.getFragmentContent(id, 'public')).toBe('content');

      await storage.close();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

