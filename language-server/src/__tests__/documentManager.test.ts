import { describe, test, expect, beforeEach } from '@jest/globals';
import { DocumentManager, DocumentState } from '../documentManager';

describe('DocumentManager', () => {
  let docManager: DocumentManager;

  beforeEach(() => {
    docManager = new DocumentManager();
  });

  describe('open', () => {
    test('should open a new document', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'console.log("hello");',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const retrieved = docManager.get(doc.uri);

      expect(retrieved).toEqual(doc);
    });

    test('should create a copy of the document state', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'console.log("hello");',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      doc.content = 'modified';

      const retrieved = docManager.get(doc.uri);
      expect(retrieved?.content).toBe('console.log("hello");');
    });
  });

  describe('applyChange', () => {
    test('should apply changes to existing document', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'original',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const updated = docManager.applyChange(doc.uri, 'modified', 2);

      expect(updated.content).toBe('modified');
      expect(updated.version).toBe(2);
      expect(updated.hasUnsavedChanges).toBe(true);
    });

    test('should throw error for non-existent document', () => {
      expect(() => {
        docManager.applyChange('file:///nonexistent.js', 'content', 1);
      }).toThrow('Document not open: file:///nonexistent.js');
    });
  });

  describe('close', () => {
    test('should remove document from manager', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      expect(docManager.get(doc.uri)).toBeDefined();

      docManager.close(doc.uri);
      expect(docManager.get(doc.uri)).toBeUndefined();
    });

    test('should not throw error for non-existent document', () => {
      expect(() => {
        docManager.close('file:///nonexistent.js');
      }).not.toThrow();
    });
  });

  describe('updateContent', () => {
    test('should update content and mark as unsaved', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'original',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const updated = docManager.updateContent(doc.uri, 'new content');

      expect(updated.content).toBe('new content');
      expect(updated.hasUnsavedChanges).toBe(true);
      expect(updated.version).toBe(2);
    });

    test('should throw error for non-existent document', () => {
      expect(() => {
        docManager.updateContent('file:///nonexistent.js', 'content');
      }).toThrow('Document not open: file:///nonexistent.js');
    });
  });

  describe('markSaved', () => {
    test('should mark document as saved', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: true
      };

      docManager.open(doc);
      const updated = docManager.markSaved(doc.uri);

      expect(updated.hasUnsavedChanges).toBe(false);
    });

    test('should throw error for non-existent document', () => {
      expect(() => {
        docManager.markSaved('file:///nonexistent.js');
      }).toThrow('Document not open: file:///nonexistent.js');
    });
  });

  describe('markSavedIfPresent', () => {
    test('should mark document as saved if it exists', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: true
      };

      docManager.open(doc);
      docManager.markSavedIfPresent(doc.uri);

      const retrieved = docManager.get(doc.uri);
      expect(retrieved?.hasUnsavedChanges).toBe(false);
    });

    test('should not throw error for non-existent document', () => {
      expect(() => {
        docManager.markSavedIfPresent('file:///nonexistent.js');
      }).not.toThrow();
    });
  });

  describe('get', () => {
    test('should return document if it exists', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const retrieved = docManager.get(doc.uri);

      expect(retrieved).toEqual(doc);
    });

    test('should return undefined for non-existent document', () => {
      const retrieved = docManager.get('file:///nonexistent.js');
      expect(retrieved).toBeUndefined();
    });

    test('should return a copy of the document', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const retrieved = docManager.get(doc.uri);
      retrieved!.content = 'modified';

      const retrievedAgain = docManager.get(doc.uri);
      expect(retrievedAgain?.content).toBe('content');
    });
  });

  describe('getRequired', () => {
    test('should return document if it exists', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const retrieved = docManager.getRequired(doc.uri);

      expect(retrieved).toEqual(doc);
    });

    test('should throw error for non-existent document', () => {
      expect(() => {
        docManager.getRequired('file:///nonexistent.js');
      }).toThrow('Document not open: file:///nonexistent.js');
    });
  });

  describe('entries', () => {
    test('should return all open documents', () => {
      const doc1: DocumentState = {
        uri: 'file:///test1.js',
        content: 'content1',
        version: 1,
        hasUnsavedChanges: false
      };

      const doc2: DocumentState = {
        uri: 'file:///test2.js',
        content: 'content2',
        version: 1,
        hasUnsavedChanges: true
      };

      docManager.open(doc1);
      docManager.open(doc2);

      const entries = docManager.entries();
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(doc1);
      expect(entries).toContainEqual(doc2);
    });

    test('should return empty array when no documents are open', () => {
      const entries = docManager.entries();
      expect(entries).toHaveLength(0);
    });

    test('should return copies of documents', () => {
      const doc: DocumentState = {
        uri: 'file:///test.js',
        content: 'content',
        version: 1,
        hasUnsavedChanges: false
      };

      docManager.open(doc);
      const entries = docManager.entries();
      entries[0].content = 'modified';

      const retrievedAgain = docManager.get(doc.uri);
      expect(retrievedAgain?.content).toBe('content');
    });
  });
});