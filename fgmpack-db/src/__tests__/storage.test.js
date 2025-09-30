"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const index_1 = require("../index");
const fgmpack_protocol_1 = require("fgmpack-protocol");
const activeContexts = [];
async function createStorageContext(options = {}) {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fragments-storage-test-'));
    const storagePath = path.join(tmpDir, 'storage.bin');
    const storage = new index_1.FragmentStorage(storagePath);
    if (!options.skipOpen) {
        await storage.open(options.versions, options.activeVersion);
        if (options.seedFragments) {
            for (const fragment of options.seedFragments) {
                const fragmentId = fragment.id;
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
            }
            catch (error) {
                // ignore cleanup errors
            }
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        },
    };
}
async function newStorageContext(options) {
    const context = await createStorageContext(options);
    activeContexts.push(context);
    return context;
}
(0, globals_1.afterEach)(async () => {
    while (activeContexts.length > 0) {
        const context = activeContexts.pop();
        if (context) {
            await context.cleanup();
        }
    }
});
(0, globals_1.describe)('FragmentStorage basic behaviour', () => {
    (0, globals_1.test)('ensures fragments and updates version contents', async () => {
        const { storage } = await newStorageContext();
        const id = 'a1b2';
        await storage.upsertFragment(id, 'initial public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('initial public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('');
        await storage.upsertFragment(id, 'secret value', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('secret value');
    });
    (0, globals_1.test)('ensuring the same fragment twice leaves the original content intact', async () => {
        const { storage } = await newStorageContext();
        const id = 'c3d4';
        await storage.upsertFragment(id, 'original body');
        await storage.upsertFragment(id, 'ignored body');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('original body');
    });
    (0, globals_1.test)('update fragment fails for non-existent fragment', async () => {
        const { storage } = await newStorageContext();
        await (0, globals_1.expect)(storage.upsertFragment('ffff', 'auto body', 'public')).rejects.toThrow("Fragment 'ffff' does not exist");
    });
    (0, globals_1.test)('persists fragment data across reopen', async () => {
        const context = await newStorageContext();
        const { storage, storagePath } = context;
        const id = (0, fgmpack_protocol_1.createFragmentId)('1234');
        await storage.upsertFragment(id, 'public body');
        await storage.upsertFragment(id, 'private body', 'private');
        await storage.close();
        const reopen = new index_1.FragmentStorage(storagePath);
        try {
            await reopen.open();
            (0, globals_1.expect)(await reopen.getFragmentContent(id, 'public')).toBe('public body');
            (0, globals_1.expect)(await reopen.getFragmentContent(id, 'private')).toBe('private body');
        }
        finally {
            await reopen.close();
        }
    });
    (0, globals_1.test)('tracks available versions and active selection across reopen', async () => {
        const context = await newStorageContext();
        const { storage, storagePath } = context;
        (0, globals_1.expect)(await storage.getAvailableVersions()).toEqual(['public', 'private']);
        (0, globals_1.expect)(await storage.getActiveVersion()).toBe('public');
        await storage.setActiveVersion('private');
        (0, globals_1.expect)(await storage.getActiveVersion()).toBe('private');
        await storage.close();
        const reopen = new index_1.FragmentStorage(storagePath);
        try {
            await reopen.open();
            (0, globals_1.expect)(await reopen.getActiveVersion()).toBe('private');
        }
        finally {
            await reopen.close();
        }
    });
    (0, globals_1.test)('returns null when requesting an unknown fragment', async () => {
        const { storage } = await newStorageContext();
        (0, globals_1.expect)(await storage.getFragmentContent('0000', 'public')).toBeNull();
    });
    (0, globals_1.test)('reflects open state when closing and reopening', async () => {
        const { storage } = await newStorageContext();
        (0, globals_1.expect)(storage.isOpen()).toBe(true);
        await storage.close();
        (0, globals_1.expect)(storage.isOpen()).toBe(false);
        await storage.open();
        (0, globals_1.expect)(storage.isOpen()).toBe(true);
    });
    (0, globals_1.test)('throws when switching to an unknown version', async () => {
        const { storage } = await newStorageContext();
        await (0, globals_1.expect)(storage.setActiveVersion('non-existent')).rejects.toThrow("Version 'non-existent' does not exist.");
    });
    (0, globals_1.test)('rejects updates to an unknown version', async () => {
        const { storage } = await newStorageContext();
        await (0, globals_1.expect)(storage.upsertFragment('fffe', 'value', 'draft')).rejects.toThrow("Version 'draft' does not exist.");
    });
    (0, globals_1.test)('rejects reads for an unknown version', async () => {
        const { storage } = await newStorageContext();
        await (0, globals_1.expect)(storage.getFragmentContent('fffd', 'draft')).rejects.toThrow("Version 'draft' does not exist.");
    });
    (0, globals_1.test)('open rejects when no versions are provided', async () => {
        const context = await newStorageContext({ skipOpen: true });
        await (0, globals_1.expect)(context.storage.open([], 'public')).rejects.toThrow('At least one version must be provided when initializing storage.');
    });
    (0, globals_1.test)('open rejects when too many versions are provided', async () => {
        const context = await newStorageContext({ skipOpen: true });
        const versions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
        await (0, globals_1.expect)(context.storage.open(versions, 'v1')).rejects.toThrow('Storage header supports up to 6 versions.');
    });
    (0, globals_1.test)('open rejects when version name exceeds the allowed length', async () => {
        const context = await newStorageContext({ skipOpen: true });
        const versions = ['public', 'x'.repeat(40)];
        await (0, globals_1.expect)(context.storage.open(versions, 'public')).rejects.toThrow(/Version name/);
    });
    (0, globals_1.test)('handles 2-byte hex fragment IDs', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('abcd');
        await storage.upsertFragment(id, 'test content');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('test content');
        await storage.upsertFragment(id, 'private content', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('private content');
    });
    (0, globals_1.test)('handles various fragment ID formats', async () => {
        const { storage } = await newStorageContext();
        // Test different valid 4-char hex IDs
        const testIds = ['0000', 'ffff', 'a1b2', '9999'];
        for (const idString of testIds) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(idString);
            await storage.upsertFragment(id, `content for ${id}`);
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(`content for ${id}`);
        }
    });
    (0, globals_1.test)('auto opens on first read request', async () => {
        const context = await newStorageContext({ skipOpen: true });
        (0, globals_1.expect)(await context.storage.getFragmentContent((0, fgmpack_protocol_1.createFragmentId)('0000'), 'public')).toBeNull();
    });
    (0, globals_1.test)('validates fragment ID format with type safety', async () => {
        // Valid fragment IDs
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('0000')).toBe(true);
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('abcd')).toBe(true);
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('ffff')).toBe(true);
        // Invalid fragment IDs
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('123')).toBe(false); // Too short
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('12345')).toBe(false); // Too long
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('gggg')).toBe(false); // Invalid hex
        (0, globals_1.expect)((0, fgmpack_protocol_1.isValidFragmentId)('ABCD')).toBe(false); // Uppercase not allowed
        // createFragmentId should throw for invalid IDs
        (0, globals_1.expect)(() => (0, fgmpack_protocol_1.createFragmentId)('invalid')).toThrow('Invalid fragment ID: invalid. Must be 4-character hex string.');
        // Valid creation should work
        const validId = (0, fgmpack_protocol_1.createFragmentId)('1234');
        (0, globals_1.expect)(validId).toBe('1234');
    });
});
(0, globals_1.describe)('FragmentStorage content edge cases', () => {
    (0, globals_1.test)('handles large fragment content within storage limits', async () => {
        const { storage } = await newStorageContext();
        const largeContent = 'x'.repeat(32000);
        const id = (0, fgmpack_protocol_1.createFragmentId)('abcd');
        await storage.upsertFragment(id, largeContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(largeContent);
        await storage.upsertFragment(id, largeContent, 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe(largeContent);
        await storage.close();
        await storage.open();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(largeContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe(largeContent);
    });
    (0, globals_1.test)('handles content near storage format limits', async () => {
        const { storage } = await newStorageContext();
        const maxContent = 'y'.repeat(65000);
        const id = (0, fgmpack_protocol_1.createFragmentId)('ffff');
        await storage.upsertFragment(id, maxContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(maxContent);
        await storage.close();
        await storage.open();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(maxContent);
    });
    (0, globals_1.test)('preserves Unicode content correctly', async () => {
        const { storage } = await newStorageContext();
        const unicodeContent = '🚀 Hello 世界 ñoño\n\t"quotes"\\backslash';
        const id = (0, fgmpack_protocol_1.createFragmentId)('def0');
        await storage.upsertFragment(id, unicodeContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(unicodeContent);
        await storage.upsertFragment(id, unicodeContent, 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe(unicodeContent);
        await storage.close();
        await storage.open();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(unicodeContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe(unicodeContent);
    });
    (0, globals_1.test)('handles empty content in all scenarios', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('0001');
        await storage.upsertFragment(id, '');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('');
        await storage.upsertFragment(id, '', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('');
        await storage.close();
        await storage.open();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('');
    });
});
(0, globals_1.describe)('FragmentStorage active version behavior', () => {
    (0, globals_1.test)('active version affects new fragment creation', async () => {
        const { storage } = await newStorageContext();
        const id1 = (0, fgmpack_protocol_1.createFragmentId)('1111');
        await storage.upsertFragment(id1, 'public content');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'public')).toBe('public content');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'private')).toBe('');
        await storage.setActiveVersion('private');
        const id2 = (0, fgmpack_protocol_1.createFragmentId)('2222');
        await storage.upsertFragment(id2, 'private content');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'public')).toBe('');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'private')).toBe('private content');
    });
    (0, globals_1.test)('getFragmentContent respects specified version regardless of active', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('3333');
        await storage.upsertFragment(id, 'public data');
        await storage.upsertFragment(id, 'private data', 'private');
        await storage.setActiveVersion('private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('public data');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('private data');
        await storage.setActiveVersion('public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('public data');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('private data');
    });
    (0, globals_1.test)('active version switching with existing fragments', async () => {
        const { storage } = await newStorageContext();
        const id1 = (0, fgmpack_protocol_1.createFragmentId)('4444');
        await storage.upsertFragment(id1, 'first public');
        await storage.setActiveVersion('private');
        const id2 = (0, fgmpack_protocol_1.createFragmentId)('5555');
        await storage.upsertFragment(id2, 'first private');
        await storage.setActiveVersion('public');
        const id3 = (0, fgmpack_protocol_1.createFragmentId)('6666');
        await storage.upsertFragment(id3, 'second public');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'public')).toBe('first public');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'private')).toBe('first private');
        (0, globals_1.expect)(await storage.getFragmentContent(id3, 'public')).toBe('second public');
    });
});
(0, globals_1.describe)('FragmentStorage cross-version operations', () => {
    (0, globals_1.test)('updating fragment in one version preserves other versions', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('7777');
        await storage.upsertFragment(id, 'initial public');
        await storage.upsertFragment(id, 'initial private', 'private');
        await storage.upsertFragment(id, 'updated private', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('initial public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('updated private');
        await storage.upsertFragment(id, 'updated public', 'public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('updated public');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('updated private');
    });
});
(0, globals_1.describe)('FragmentStorage multiple fragment scenarios', () => {
    (0, globals_1.test)('handles many fragments efficiently', async () => {
        const { storage } = await newStorageContext();
        const fragmentCount = 100;
        for (let i = 0; i < fragmentCount; i++) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(i.toString(16).padStart(4, '0'));
            await storage.upsertFragment(id, `content ${i}`);
        }
        for (let i = 0; i < fragmentCount; i++) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(i.toString(16).padStart(4, '0'));
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(`content ${i}`);
        }
        await storage.close();
        await storage.open();
        for (let i = 0; i < fragmentCount; i++) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(i.toString(16).padStart(4, '0'));
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(`content ${i}`);
        }
    });
    (0, globals_1.test)('fragments with identical content are handled correctly', async () => {
        const { storage } = await newStorageContext();
        const sharedContent = 'shared content';
        const id1 = (0, fgmpack_protocol_1.createFragmentId)('8888');
        const id2 = (0, fgmpack_protocol_1.createFragmentId)('9999');
        const id3 = (0, fgmpack_protocol_1.createFragmentId)('aaaa');
        await storage.upsertFragment(id1, sharedContent);
        await storage.upsertFragment(id2, sharedContent);
        await storage.upsertFragment(id3, sharedContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'public')).toBe(sharedContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'public')).toBe(sharedContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id3, 'public')).toBe(sharedContent);
        await storage.upsertFragment(id1, 'unique content', 'public');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'public')).toBe('unique content');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'public')).toBe(sharedContent);
        (0, globals_1.expect)(await storage.getFragmentContent(id3, 'public')).toBe(sharedContent);
    });
});
(0, globals_1.describe)('FragmentStorage sequential operations', () => {
    (0, globals_1.test)('mixed create and update operations maintain consistency', async () => {
        const { storage } = await newStorageContext();
        const id1 = (0, fgmpack_protocol_1.createFragmentId)('bbbb');
        const id2 = (0, fgmpack_protocol_1.createFragmentId)('cccc');
        await storage.upsertFragment(id1, 'first');
        await storage.setActiveVersion('private');
        await storage.upsertFragment(id2, 'second');
        await storage.upsertFragment(id1, 'updated first', 'public');
        await storage.setActiveVersion('public');
        await storage.upsertFragment(id1, 'ignored');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'public')).toBe('updated first');
        (0, globals_1.expect)(await storage.getFragmentContent(id1, 'private')).toBe('');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'public')).toBe('');
        (0, globals_1.expect)(await storage.getFragmentContent(id2, 'private')).toBe('second');
    });
    (0, globals_1.test)('error in middle of operations leaves storage in valid state', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('dddd');
        await storage.upsertFragment(id, 'valid content');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('valid content');
        await (0, globals_1.expect)(storage.upsertFragment(id, 'should fail', 'nonexistent')).rejects.toThrow();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('valid content');
        await storage.upsertFragment(id, 'still works', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('still works');
    });
});
(0, globals_1.describe)('FragmentStorage boundary conditions', () => {
    (0, globals_1.test)('fragment ID boundary conditions', async () => {
        const { storage } = await newStorageContext();
        const boundaries = ['0000', 'ffff', '1234', 'abcd', 'f0f0'];
        for (const idStr of boundaries) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(idStr);
            await storage.upsertFragment(id, `content for ${idStr}`);
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(`content for ${idStr}`);
        }
        await storage.close();
        await storage.open();
        for (const idStr of boundaries) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(idStr);
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe(`content for ${idStr}`);
        }
    });
});
(0, globals_1.describe)('FragmentStorage state consistency', () => {
    (0, globals_1.test)('storage remains functional after failed operations', async () => {
        const { storage } = await newStorageContext();
        const id = (0, fgmpack_protocol_1.createFragmentId)('eeee');
        await storage.upsertFragment(id, 'initial content');
        await (0, globals_1.expect)(storage.setActiveVersion('invalid')).rejects.toThrow();
        await (0, globals_1.expect)(storage.getFragmentContent(id, 'invalid')).rejects.toThrow();
        await (0, globals_1.expect)(storage.upsertFragment(id, 'content', 'invalid')).rejects.toThrow();
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('initial content');
        await storage.upsertFragment(id, 'updated content', 'private');
        (0, globals_1.expect)(await storage.getFragmentContent(id, 'private')).toBe('updated content');
        (0, globals_1.expect)(await storage.getActiveVersion()).toBe('public');
    });
    (0, globals_1.test)('concurrent-like operation sequence', async () => {
        const { storage } = await newStorageContext();
        const operations = [];
        for (let i = 0; i < 50; i++) {
            const id = (0, fgmpack_protocol_1.createFragmentId)((i % 10).toString().padStart(4, '0'));
            operations.push(storage.upsertFragment(id, `version ${i}`));
        }
        await Promise.all(operations);
        for (let i = 0; i < 10; i++) {
            const id = (0, fgmpack_protocol_1.createFragmentId)(i.toString().padStart(4, '0'));
            const content = await storage.getFragmentContent(id, 'public');
            (0, globals_1.expect)(content).toMatch(/^version \d+$/);
        }
    });
});
(0, globals_1.describe)('FragmentStorage resilience', () => {
    (0, globals_1.test)('handles corrupted storage files gracefully', async () => {
        const context = await newStorageContext({ seedFragments: [{ id: '1111', public: 'data' }] });
        await context.storage.close();
        await fs.promises.writeFile(context.storagePath, Buffer.from('corrupted data'));
        const reopen = new index_1.FragmentStorage(context.storagePath);
        await (0, globals_1.expect)(reopen.open()).rejects.toThrow();
    });
    (0, globals_1.test)('handles truncated storage files', async () => {
        const context = await newStorageContext({ seedFragments: [{ id: '2222', public: 'data' }] });
        await context.storage.close();
        await fs.promises.writeFile(context.storagePath, Buffer.alloc(10));
        const reopen = new index_1.FragmentStorage(context.storagePath);
        await (0, globals_1.expect)(reopen.open()).rejects.toThrow();
    });
    (0, globals_1.test)('handles empty storage files', async () => {
        const context = await newStorageContext({ seedFragments: [{ id: '3333', public: 'data' }] });
        await context.storage.close();
        await fs.promises.writeFile(context.storagePath, Buffer.alloc(0));
        const reopen = new index_1.FragmentStorage(context.storagePath);
        await (0, globals_1.expect)(reopen.open()).rejects.toThrow();
    });
    (0, globals_1.test)('recovers gracefully from missing storage file', async () => {
        const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fragments-test-'));
        const missingPath = path.join(tmpDir, 'missing.bin');
        try {
            const storage = new index_1.FragmentStorage(missingPath);
            await storage.open();
            const id = (0, fgmpack_protocol_1.createFragmentId)('1234');
            await storage.upsertFragment(id, 'content');
            (0, globals_1.expect)(await storage.getFragmentContent(id, 'public')).toBe('content');
            await storage.close();
        }
        finally {
            await fs.promises.rm(tmpDir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=storage.test.js.map