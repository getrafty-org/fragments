import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { FragmentsServer } from '../server';
import { FragmentRequestMessage, FragmentResponseMessage } from 'fgmpack-protocol';

// Mock dependencies
jest.mock('fgmpack-db');
jest.mock('../document_manager');
jest.mock('../fragment_service');
jest.mock('../fragment_file_locator');
jest.mock('../revision_state');

describe('FragmentsServer', () => {
  let server: FragmentsServer;
  let mockStdout: any;
  let mockStderr: any;

  beforeEach(() => {
    // Mock process.stdout.write and process.stderr.write
    mockStdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockStderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    server = new FragmentsServer('/tmp/test-storage');
  });

  afterEach(() => {
    mockStdout.mockRestore();
    mockStderr.mockRestore();
  });

  describe('constructor', () => {
    test('should create server with storage file path', () => {
      expect(server).toBeInstanceOf(FragmentsServer);
    });
  });

  describe('message handling', () => {
    test('should handle valid request message', async () => {
      const request: FragmentRequestMessage = {
        id: 1,
        method: 'frag.query.getVersion',
        params: {}
      };

      // Mock the private handleMessage method by calling it through reflection
      const handleMessage = (server as any).handleMessage.bind(server);
      await handleMessage(JSON.stringify(request));

      expect(mockStdout).toHaveBeenCalledWith(
        expect.stringContaining('"id":1')
      );
    });

    test('should handle malformed JSON message', async () => {
      const malformedJson = '{"invalid": json}';

      const handleMessage = (server as any).handleMessage.bind(server);
      await handleMessage(malformedJson);

      expect(mockStdout).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
    });

    test('should handle request with unknown method', async () => {
      const request: FragmentRequestMessage = {
        id: 2,
        method: 'unknown.method' as any,
        params: {}
      };

      const handleMessage = (server as any).handleMessage.bind(server);
      await handleMessage(JSON.stringify(request));

      expect(mockStdout).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
    });
  });

  describe('sendResponse', () => {
    test('should send response to stdout', () => {
      const response: FragmentResponseMessage = {
        id: 1,
        result: { success: true }
      };

      const sendResponse = (server as any).sendResponse.bind(server);
      sendResponse(response);

      expect(mockStdout).toHaveBeenCalledWith(
        JSON.stringify(response) + '\n'
      );
    });

    test('should send error response to stdout', () => {
      const response: FragmentResponseMessage = {
        id: 1,
        error: { code: -1, message: 'Test error' }
      };

      const sendResponse = (server as any).sendResponse.bind(server);
      sendResponse(response);

      expect(mockStdout).toHaveBeenCalledWith(
        JSON.stringify(response) + '\n'
      );
    });
  });

  describe('document event handlers', () => {
    test('should handle didOpenDocument event', async () => {
      const params = {
        textDocument: {
          uri: 'file:///test.js',
          text: 'console.log("test");',
          version: 1
        }
      };

      const handleDidOpen = (server as any).handleDidOpen.bind(server);
      const result = await handleDidOpen(params);

      expect(result.success).toBe(true);
    });

    test('should handle didChangeDocument event', async () => {
      const openParams = {
        textDocument: {
          uri: 'file:///test.js',
          text: 'console.log("test");',
          version: 1
        }
      };

      const changeParams = {
        textDocument: {
          uri: 'file:///test.js',
          version: 2
        },
        contentChanges: [
          {
            text: 'console.log("changed");'
          }
        ]
      };

      const handleDidOpen = (server as any).handleDidOpen.bind(server);
      const handleDidChange = (server as any).handleDidChange.bind(server);

      await handleDidOpen(openParams);
      const result = await handleDidChange(changeParams);

      expect(result.success).toBe(true);
    });

    test('should handle didCloseDocument event', async () => {
      const openParams = {
        textDocument: {
          uri: 'file:///test.js',
          text: 'console.log("test");',
          version: 1
        }
      };

      const closeParams = {
        textDocument: {
          uri: 'file:///test.js'
        }
      };

      const handleDidOpen = (server as any).handleDidOpen.bind(server);
      const handleDidClose = (server as any).handleDidClose.bind(server);

      await handleDidOpen(openParams);
      const result = await handleDidClose(closeParams);

      expect(result.success).toBe(true);
    });
  });

  describe('handler creation', () => {
    test('should create all required handlers', () => {
      const handlers = (server as any).createHandlers();

      const expectedHandlers = [
        'frag.event.didOpenDocument',
        'frag.event.didChangeDocument',
        'frag.event.didCloseDocument',
        'frag.event.didPersistDocument',
        'frag.action.pullFragments',
        'frag.action.pushFragments',
        'frag.action.changeVersion',
        'frag.action.insertMarker',
        'frag.query.getVersion',
        'frag.query.getFragmentPositions',
        'frag.query.getAllFragmentRanges'
      ];

      const actualHandlers = Object.keys(handlers);

      expectedHandlers.forEach(handlerName => {
        expect(actualHandlers).toContain(handlerName);
      });

      expect(actualHandlers).toHaveLength(expectedHandlers.length);

      // Verify all handlers are functions
      Object.values(handlers).forEach(handler => {
        expect(typeof handler).toBe('function');
      });
    });
  });
});
