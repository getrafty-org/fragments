import { afterEach, describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FragmentStorage } from '../index';
import { FragmentID, isValidFragmentId, createFragmentId } from 'fgmpack-protocol';


type SeedFragment = {
  id: string;
  public?: string;
  private?: string;
};

type StorageOptions = {
  versions?: string[];
  activeVersion?: string;
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
  const storage = new FragmentStorage(storagePath);

  if (!options.skipOpen) {
    await storage.open(options.versions, options.activeVersion);
    if (options.seedFragments) {
      for (const fragment of options.seedFragments) {
        const fragmentId = fragment.id as FragmentID;
        await storage.upsertFragment(fragmentId, fragment.public ?? '');
        if (fragment.private !== undefined) {
          await storage.upsertFragment(fragmentId, fragment.private, 'private');
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

    const id: FragmentID = 'a1b2';
    await storage.upsertFragment(id, 'initial public');
    expect(await storage.getFragmentContent(id, 'public')).toBe('initial public');
    expect(await storage.getFragmentContent(id, 'private')).toBe('');

    await storage.upsertFragment(id, 'secret value', 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe('secret value');
  });

  test('ensuring the same fragment twice leaves the original content intact', async () => {
    const { storage } = await newStorageContext();

    const id: FragmentID = 'c3d4';
    await storage.upsertFragment(id, 'original body');
    await storage.upsertFragment(id, 'ignored body');

    expect(await storage.getFragmentContent(id, 'public')).toBe('original body');
  });

  test('update fragment fails for non-existent fragment', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.upsertFragment('ffff', 'auto body', 'public')).rejects.toThrow("Fragment 'ffff' does not exist");
  });

  test('persists fragment data across reopen', async () => {
    const context = await newStorageContext();
    const { storage, storagePath } = context;

    const id = createFragmentId('1234');
    await storage.upsertFragment(id, 'public body');
    await storage.upsertFragment(id, 'private body', 'private');
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

    await storage.setActiveVersion('private');
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

    expect(await storage.getFragmentContent('0000', 'public')).toBeNull();
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

    await expect(storage.setActiveVersion('non-existent')).rejects.toThrow("Version 'non-existent' does not exist.");
  });

  test('rejects updates to an unknown version', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.upsertFragment('fffe', 'value', 'draft',)).rejects.toThrow("Version 'draft' does not exist.");
  });

  test('rejects reads for an unknown version', async () => {
    const { storage } = await newStorageContext();

    await expect(storage.getFragmentContent('fffd', 'draft')).rejects.toThrow("Version 'draft' does not exist.");
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
    await storage.upsertFragment(id, 'test content');
    expect(await storage.getFragmentContent(id, 'public')).toBe('test content');

    await storage.upsertFragment(id, 'private content', 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe('private content');
  });

  test('handles various fragment ID formats', async () => {
    const { storage } = await newStorageContext();

    // Test different valid 4-char hex IDs
    const testIds = ['0000', 'ffff', 'a1b2', '9999'];

    for (const idString of testIds) {
      const id = createFragmentId(idString);
      await storage.upsertFragment(id, `content for ${id}`);
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

});

describe('FragmentStorage content edge cases', () => {
  test('handles large fragment content within storage limits', async () => {
    const { storage } = await newStorageContext();
    const largeContent = 'x'.repeat(32000);

    const id = createFragmentId('abcd');
    await storage.upsertFragment(id, largeContent);
    expect(await storage.getFragmentContent(id, 'public')).toBe(largeContent);

    await storage.upsertFragment(id, largeContent, 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe(largeContent);

    await storage.close();
    await storage.open();
    expect(await storage.getFragmentContent(id, 'public')).toBe(largeContent);
    expect(await storage.getFragmentContent(id, 'private')).toBe(largeContent);
  });

  test('handles content near storage format limits', async () => {
    const { storage } = await newStorageContext();
    const maxContent = 'y'.repeat(65000);

    const id = createFragmentId('ffff');
    await storage.upsertFragment(id, maxContent);
    expect(await storage.getFragmentContent(id, 'public')).toBe(maxContent);

    await storage.close();
    await storage.open();
    expect(await storage.getFragmentContent(id, 'public')).toBe(maxContent);
  });

  test('preserves Unicode content correctly', async () => {
    const { storage } = await newStorageContext();
    const unicodeContent = '🚀 Hello 世界 ñoño\n\t"quotes"\\backslash';

    const id = createFragmentId('def0');
    await storage.upsertFragment(id, unicodeContent);
    expect(await storage.getFragmentContent(id, 'public')).toBe(unicodeContent);

    await storage.upsertFragment(id, unicodeContent, 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe(unicodeContent);

    await storage.close();
    await storage.open();
    expect(await storage.getFragmentContent(id, 'public')).toBe(unicodeContent);
    expect(await storage.getFragmentContent(id, 'private')).toBe(unicodeContent);
  });

  test('handles empty content in all scenarios', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('0001');
    await storage.upsertFragment(id, '');
    expect(await storage.getFragmentContent(id, 'public')).toBe('');
    expect(await storage.getFragmentContent(id, 'private')).toBe('');

    await storage.upsertFragment(id, '', 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe('');

    await storage.close();
    await storage.open();
    expect(await storage.getFragmentContent(id, 'public')).toBe('');
    expect(await storage.getFragmentContent(id, 'private')).toBe('');
  });
});

describe('FragmentStorage active version behavior', () => {
  test('active version affects new fragment creation', async () => {
    const { storage } = await newStorageContext();

    const id1 = createFragmentId('1111');
    await storage.upsertFragment(id1, 'public content');
    expect(await storage.getFragmentContent(id1, 'public')).toBe('public content');
    expect(await storage.getFragmentContent(id1, 'private')).toBe('');

    await storage.setActiveVersion('private');
    const id2 = createFragmentId('2222');
    await storage.upsertFragment(id2, 'private content');
    expect(await storage.getFragmentContent(id2, 'public')).toBe('');
    expect(await storage.getFragmentContent(id2, 'private')).toBe('private content');
  });

  test('getFragmentContent respects specified version regardless of active', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('3333');
    await storage.upsertFragment(id, 'public data');
    await storage.upsertFragment(id, 'private data', 'private');

    await storage.setActiveVersion('private');
    expect(await storage.getFragmentContent(id, 'public')).toBe('public data');
    expect(await storage.getFragmentContent(id, 'private')).toBe('private data');

    await storage.setActiveVersion('public');
    expect(await storage.getFragmentContent(id, 'public')).toBe('public data');
    expect(await storage.getFragmentContent(id, 'private')).toBe('private data');
  });

  test('active version switching with existing fragments', async () => {
    const { storage } = await newStorageContext();

    const id1 = createFragmentId('4444');
    await storage.upsertFragment(id1, 'first public');

    await storage.setActiveVersion('private');
    const id2 = createFragmentId('5555');
    await storage.upsertFragment(id2, 'first private');

    await storage.setActiveVersion('public');
    const id3 = createFragmentId('6666');
    await storage.upsertFragment(id3, 'second public');

    expect(await storage.getFragmentContent(id1, 'public')).toBe('first public');
    expect(await storage.getFragmentContent(id2, 'private')).toBe('first private');
    expect(await storage.getFragmentContent(id3, 'public')).toBe('second public');
  });
});

describe('FragmentStorage cross-version operations', () => {
  test('updating fragment in one version preserves other versions', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('7777');
    await storage.upsertFragment(id, 'initial public');
    await storage.upsertFragment(id, 'initial private', 'private');

    await storage.upsertFragment(id, 'updated private', 'private');
    expect(await storage.getFragmentContent(id, 'public')).toBe('initial public');
    expect(await storage.getFragmentContent(id, 'private')).toBe('updated private');

    await storage.upsertFragment(id, 'updated public', 'public');
    expect(await storage.getFragmentContent(id, 'public')).toBe('updated public');
    expect(await storage.getFragmentContent(id, 'private')).toBe('updated private');
  });
});

describe('FragmentStorage multiple fragment scenarios', () => {
  test('handles many fragments efficiently', async () => {
    const { storage } = await newStorageContext();
    const fragmentCount = 100;

    for (let i = 0; i < fragmentCount; i++) {
      const id = createFragmentId(i.toString(16).padStart(4, '0'));
      await storage.upsertFragment(id, `content ${i}`);
    }

    for (let i = 0; i < fragmentCount; i++) {
      const id = createFragmentId(i.toString(16).padStart(4, '0'));
      expect(await storage.getFragmentContent(id, 'public')).toBe(`content ${i}`);
    }

    await storage.close();
    await storage.open();

    for (let i = 0; i < fragmentCount; i++) {
      const id = createFragmentId(i.toString(16).padStart(4, '0'));
      expect(await storage.getFragmentContent(id, 'public')).toBe(`content ${i}`);
    }
  });

  test('fragments with identical content are handled correctly', async () => {
    const { storage } = await newStorageContext();
    const sharedContent = 'shared content';

    const id1 = createFragmentId('8888');
    const id2 = createFragmentId('9999');
    const id3 = createFragmentId('aaaa');

    await storage.upsertFragment(id1, sharedContent);
    await storage.upsertFragment(id2, sharedContent);
    await storage.upsertFragment(id3, sharedContent);

    expect(await storage.getFragmentContent(id1, 'public')).toBe(sharedContent);
    expect(await storage.getFragmentContent(id2, 'public')).toBe(sharedContent);
    expect(await storage.getFragmentContent(id3, 'public')).toBe(sharedContent);

    await storage.upsertFragment(id1, 'unique content', 'public');
    expect(await storage.getFragmentContent(id1, 'public')).toBe('unique content');
    expect(await storage.getFragmentContent(id2, 'public')).toBe(sharedContent);
    expect(await storage.getFragmentContent(id3, 'public')).toBe(sharedContent);
  });
});

describe('FragmentStorage sequential operations', () => {
  test('mixed create and update operations maintain consistency', async () => {
    const { storage } = await newStorageContext();

    const id1 = createFragmentId('bbbb');
    const id2 = createFragmentId('cccc');

    await storage.upsertFragment(id1, 'first');
    await storage.setActiveVersion('private');
    await storage.upsertFragment(id2, 'second');
    await storage.upsertFragment(id1, 'updated first', 'public');
    await storage.setActiveVersion('public');
    await storage.upsertFragment(id1, 'ignored');

    expect(await storage.getFragmentContent(id1, 'public')).toBe('updated first');
    expect(await storage.getFragmentContent(id1, 'private')).toBe('');
    expect(await storage.getFragmentContent(id2, 'public')).toBe('');
    expect(await storage.getFragmentContent(id2, 'private')).toBe('second');
  });

  test('error in middle of operations leaves storage in valid state', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('dddd');
    await storage.upsertFragment(id, 'valid content');
    expect(await storage.getFragmentContent(id, 'public')).toBe('valid content');

    await expect(storage.upsertFragment(id, 'should fail', 'nonexistent')).rejects.toThrow();

    expect(await storage.getFragmentContent(id, 'public')).toBe('valid content');
    await storage.upsertFragment(id, 'still works', 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe('still works');
  });
});

describe('FragmentStorage boundary conditions', () => {
  test('fragment ID boundary conditions', async () => {
    const { storage } = await newStorageContext();

    const boundaries = ['0000', 'ffff', '1234', 'abcd', 'f0f0'];

    for (const idStr of boundaries) {
      const id = createFragmentId(idStr);
      await storage.upsertFragment(id, `content for ${idStr}`);
      expect(await storage.getFragmentContent(id, 'public')).toBe(`content for ${idStr}`);
    }

    await storage.close();
    await storage.open();

    for (const idStr of boundaries) {
      const id = createFragmentId(idStr);
      expect(await storage.getFragmentContent(id, 'public')).toBe(`content for ${idStr}`);
    }
  });
});

describe('FragmentStorage state consistency', () => {
  test('storage remains functional after failed operations', async () => {
    const { storage } = await newStorageContext();

    const id = createFragmentId('eeee');
    await storage.upsertFragment(id, 'initial content');

    await expect(storage.setActiveVersion('invalid')).rejects.toThrow();
    await expect(storage.getFragmentContent(id, 'invalid')).rejects.toThrow();
    await expect(storage.upsertFragment(id, 'content', 'invalid')).rejects.toThrow();

    expect(await storage.getFragmentContent(id, 'public')).toBe('initial content');
    await storage.upsertFragment(id, 'updated content', 'private');
    expect(await storage.getFragmentContent(id, 'private')).toBe('updated content');
    expect(await storage.getActiveVersion()).toBe('public');
  });

  test('concurrent-like operation sequence', async () => {
    const { storage } = await newStorageContext();

    const operations = [];
    for (let i = 0; i < 50; i++) {
      const id = createFragmentId((i % 10).toString().padStart(4, '0'));
      operations.push(storage.upsertFragment(id, `version ${i}`));
    }

    await Promise.all(operations);

    for (let i = 0; i < 10; i++) {
      const id = createFragmentId(i.toString().padStart(4, '0'));
      const content = await storage.getFragmentContent(id, 'public');
      expect(content).toMatch(/^version \d+$/);
    }
  });
});

describe('FragmentStorage resilience', () => {
  test('handles corrupted storage files gracefully', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '1111', public: 'data' }] });
    await context.storage.close();

    await fs.promises.writeFile(context.storagePath, Buffer.from('corrupted data'));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('handles truncated storage files', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '2222', public: 'data' }] });
    await context.storage.close();

    await fs.promises.writeFile(context.storagePath, Buffer.alloc(10));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('handles empty storage files', async () => {
    const context = await newStorageContext({ seedFragments: [{ id: '3333', public: 'data' }] });
    await context.storage.close();

    await fs.promises.writeFile(context.storagePath, Buffer.alloc(0));

    const reopen = new FragmentStorage(context.storagePath);
    await expect(reopen.open()).rejects.toThrow();
  });

  test('recovers gracefully from missing storage file', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fragments-test-'));
    const missingPath = path.join(tmpDir, 'missing.bin');

    try {
      const storage = new FragmentStorage(missingPath);
      await storage.open();

      const id = createFragmentId('1234');
      await storage.upsertFragment(id, 'content');
      expect(await storage.getFragmentContent(id, 'public')).toBe('content');

      await storage.close();
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
