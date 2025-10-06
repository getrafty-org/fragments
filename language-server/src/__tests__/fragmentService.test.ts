import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { FragmentService } from '../fragmentService';
import { DocumentManager } from '../documentManager';
import { MockStorage } from './mocks/mockStorage';
import { MockFragmentFileLocator } from './mocks/mockFileLocator';
import { MockRevisionState } from './mocks/mockRevisionState';
import { FragmentID } from 'fgmpack-protocol';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn()
  }
}));

describe('FragmentService', () => {
  let service: FragmentService;
  let documents: DocumentManager;
  let storage: MockStorage;
  let fileLocator: MockFragmentFileLocator;
  let revisionState: MockRevisionState;

  beforeEach(() => {
    documents = new DocumentManager();
    storage = new MockStorage();
    fileLocator = new MockFragmentFileLocator();
    revisionState = new MockRevisionState();

    service = new FragmentService(documents, storage, fileLocator, revisionState);

    // Mock storage as open
    storage.open();
  });

  describe('pullFragments', () => {
    test('should pull fragments from document and update content', async () => {
      const uri = 'file:///test.js';
      const originalContent = `
// ==== YOUR CODE: @abcd ====

// ==== END YOUR CODE ====
`;

      documents.open({
        uri,
        content: originalContent,
        version: 1,
        hasUnsavedChanges: false
      });

      // Pre-populate storage with different content
      // First create the fragment, then update it with different content
      await storage.upsertFragment('abcd' as FragmentID, 'original content'); // Create fragment
      await storage.upsertFragment('abcd' as FragmentID, 'updated content', 'public'); // Update with different content

      const result = await service.pullFragments({
        textDocument: { uri }
      });

      expect(result.success).toBe(true);
      // Now pullFragments should preserve the existing "updated content" and pull it into the document
      expect(result.hasChanges).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.newContent).toContain('updated content');
    });

    test('should handle fragments with no changes', async () => {
      const uri = 'file:///test.js';
      const content = `
// ==== YOUR CODE: @abcd ====
same content
// ==== END YOUR CODE ====
`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      // Fragment has same content in storage
      await storage.upsertFragment('abcd' as FragmentID, 'same content');

      const result = await service.pullFragments({
        textDocument: { uri }
      });

      expect(result.success).toBe(true);
      expect(result.hasChanges).toBe(false);
      expect(result.appliedCount).toBe(0);
    });

    test('should pull fragments from file path', async () => {
      const filePath = '/path/to/file.js';
      const fileContent = `
// ==== YOUR CODE: @1234 ====

// ==== END YOUR CODE ====
`;

      (fs.promises.readFile as jest.MockedFunction<typeof fs.promises.readFile>).mockResolvedValue(fileContent);

      await storage.upsertFragment('1234' as FragmentID, 'updated file content');

      const result = await service.pullFragments({
        filePath
      });

      expect(result.success).toBe(true);
      expect(result.newContent).toContain('updated file content');
    });

    test('should throw error when neither textDocument nor filePath provided', async () => {
      await expect(service.pullFragments({} as any)).rejects.toThrow(
        'Either textDocument or filePath required'
      );
    });
  });

  describe('pushFragments', () => {
    test('should push fragments to storage successfully', async () => {
      const uri = 'file:///test.js';
      const content = `
// ==== YOUR CODE: @abcd ====
content to save
// ==== END YOUR CODE ====
`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      const result = await service.pushFragments({
        textDocument: { uri }
      });

      expect(result.success).toBe(true);
      expect(result.fragmentsSaved).toBe(1);
      expect(await storage.getFragmentContent('abcd' as FragmentID, 'public')).toBe('content to save');
    });

    test('should detect nested fragments and return error', async () => {
      const uri = 'file:///test.js';
      const content = `
// ==== YOUR CODE: @outer ====
outer content
// ==== YOUR CODE: @inner ====
nested content
// ==== END YOUR CODE ====
more outer content
// ==== END YOUR CODE ====
`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      const result = await service.pushFragments({
        textDocument: { uri }
      });

      expect(result.success).toBe(false);
      expect(result.fragmentsSaved).toBe(0);
      expect(result.issues).toBeDefined();
      expect(result.issues![0].type).toBe('nested-fragment');
    });

    test('should mark document as saved after successful push', async () => {
      const uri = 'file:///test.js';
      const content = `
// ==== YOUR CODE: @test ====
test content
// ==== END YOUR CODE ====
`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: true
      });

      await service.pushFragments({
        textDocument: { uri }
      });

      const doc = documents.get(uri);
      expect(doc?.hasUnsavedChanges).toBe(false);
    });
  });

  describe('changeVersion', () => {
    test('should change version and update all documents', async () => {
      const uri1 = 'file:///test1.js';
      const uri2 = 'file:///test2.js';

      const content1 = `
// ==== YOUR CODE: @1234 ====
version content 1
// ==== END YOUR CODE ====
`;

      const content2 = `
// ==== YOUR CODE: @5678 ====

// ==== END YOUR CODE ====
`;

      documents.open({ uri: uri1, content: content1, version: 1, hasUnsavedChanges: false });
      documents.open({ uri: uri2, content: content2, version: 1, hasUnsavedChanges: false });

      // Pre-populate storage with fragments that have different content in private version
      // These fragments should already exist with the document content in public and different content in private
      await storage.upsertFragment('1234' as FragmentID, 'version content 1'); // public version
      await storage.upsertFragment('5678' as FragmentID, 'version content 2'); // public version

      // Set different content in private version
      await storage.upsertFragment('1234' as FragmentID, 'private content 1', 'private');
      await storage.upsertFragment('5678' as FragmentID, 'private content 2', 'private');

      const result = await service.changeVersion({ version: 'private' });

      expect(result.success).toBe(true);
      expect(result.version).toBe('private');
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].content).toContain('private content');
      expect(result.documents[1].content).toContain('private content');
    });
  });

  describe('acknowledgePersist', () => {
    test('should acknowledge persist with valid revision', () => {
      const uri = 'file:///test.js';
      const revision = 5;

      revisionState.setRevision(uri, revision);

      const result = service.acknowledgePersist({ uri, revision });

      expect(result.success).toBe(true);
    });
  });

  describe('insertMarker', () => {
    test('should generate unique fragment ID and marker text', async () => {
      const result = await service.insertMarker({
        languageId: 'javascript',
        lineContent: 'console.log("test");',
        indentation: '  '
      });

      expect(result.success).toBe(true);
      expect(result.fragmentId).toBeDefined();
      expect(result.markerText).toBeDefined();
      expect(result.insertPosition).toBeDefined();
      expect(typeof result.fragmentId).toBe('string');
      expect(result.fragmentId).toHaveLength(4);
    });
  });

  describe('getVersion', () => {
    test('should return version info when storage is open', async () => {
      const result = await service.getVersion();

      expect(result.initialized).toBe(true);
      expect(result.activeVersion).toBe('public');
      expect(result.availableVersions).toEqual(['public', 'private']);
    });

    test('should return default version info when storage is not open', async () => {
      storage.close();
      const result = await service.getVersion();

      expect(result.initialized).toBe(false);
      expect(result.activeVersion).toBe('public');
      expect(result.availableVersions).toEqual(['public', 'private']);
    });
  });

  describe('getFragmentPositions', () => {
    test('should return marker ranges for fragment start line', async () => {
      const uri = 'file:///test.js';
      const content = `line 0
// ==== YOUR CODE: @test ====
fragment content
// ==== END YOUR CODE ====
line 4`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      const result = await service.getFragmentPositions({
        textDocument: { uri },
        line: 1 // Fragment start line
      });

      expect(result.success).toBe(true);
      expect(result.markerRanges).toHaveLength(2); // Start and end markers
      expect(result.markerRanges![0].isStartMarker).toBe(true);
      expect(result.markerRanges![1].isEndMarker).toBe(true);
    });

    test('should return empty ranges for non-fragment line', async () => {
      const uri = 'file:///test.js';
      const content = 'regular line content';

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      const result = await service.getFragmentPositions({
        textDocument: { uri },
        line: 0
      });

      expect(result.success).toBe(true);
      expect(result.markerRanges).toHaveLength(0);
    });
  });

  describe('getAllFragmentRanges', () => {
    test('should return all fragment ranges in document', async () => {
      const uri = 'file:///test.js';
      const content = `line 0
// ==== YOUR CODE: @frag1 ====
content 1
// ==== END YOUR CODE ====
line 4
// ==== YOUR CODE: @frag2 ====
content 2
// ==== END YOUR CODE ====
line 8`;

      documents.open({
        uri,
        content,
        version: 1,
        hasUnsavedChanges: false
      });

      const result = await service.getAllFragmentRanges({
        textDocument: { uri }
      });

      expect(result.success).toBe(true);
      expect(result.fragments).toHaveLength(2);
      expect(result.fragments![0].id).toBe('frag1');
      expect(result.fragments![1].id).toBe('frag2');
    });
  });
});
