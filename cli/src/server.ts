#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { FragmentStorage, IFragmentStorage } from './storage';
import { FragmentUtils } from './fragmentUtils';

interface DocumentState {
  uri: string;
  content: string;
  version: number;
  hasUnsavedChanges: boolean;
}

interface FragmentRequest {
  id: number;
  method: string;
  params: any;
}

interface FragmentResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export class FragmentsServer {
  private openFiles = new Map<string, DocumentState>();
  private storage: IFragmentStorage;

  constructor(storageFile: string) {
    this.storage = new FragmentStorage(storageFile);
  }

  async start() {
    process.stdin.setEncoding('utf8');

    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk;

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          this.handleMessage(line);
        }
      }
    });

    // Keep process alive
    process.stdin.resume();
  }

  private async handleMessage(messageStr: string) {
    try {
      const request = JSON.parse(messageStr) as FragmentRequest;
      let result;

      switch (request.method) {
        case 'textDocument/didOpen':
          result = await this.textDocumentDidOpen(request.params);
          break;
        case 'textDocument/didChange':
          result = await this.textDocumentDidChange(request.params);
          break;
        case 'textDocument/didClose':
          result = await this.textDocumentDidClose(request.params);
          break;
        case 'fragments/apply':
          result = await this.applyFragments(request.params);
          break;
        case 'fragments/save':
          result = await this.saveFragments(request.params);
          break;
        case 'fragments/switchVersion':
          result = await this.switchVersion(request.params);
          break;
        case 'fragments/generateMarker':
          result = await this.generateMarker(request.params);
          break;
        case 'fragments/getVersion':
          result = await this.getVersion();
          break;
        case 'fragments/getFragmentPositions':
          result = await this.getFragmentPositions(request.params);
          break;
        case 'fragments/getAllFragmentRanges':
          result = await this.getAllFragmentRanges(request.params);
          break;
        case 'fragments/init':
          result = await this.init(request.params);
          break;
        default:
          throw new Error(`Unknown method: ${request.method}`);
      }

      this.sendResponse({ id: request.id, result });
    } catch (error) {
      this.sendResponse({
        id: 0,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private sendResponse(response: FragmentResponse) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  // Document lifecycle methods
  async textDocumentDidOpen(params: { textDocument: { uri: string; text: string; version: number } }) {
    const { uri, text, version } = params.textDocument;

    this.openFiles.set(uri, {
      uri,
      content: text,
      version,
      hasUnsavedChanges: false
    });

    return { success: true };
  }

  async textDocumentDidChange(params: { textDocument: { uri: string; version: number }; contentChanges: Array<{ text: string }> }) {
    const { uri, version } = params.textDocument;
    const newContent = params.contentChanges[0].text;

    this.openFiles.set(uri, {
      uri,
      content: newContent,
      version,
      hasUnsavedChanges: true
    });

    return { success: true };
  }

  async textDocumentDidClose(params: { textDocument: { uri: string } }) {
    this.openFiles.delete(params.textDocument.uri);
    return { success: true };
  }

  // Fragment operations
  async applyFragments(params: { textDocument?: { uri: string }; filePath?: string }) {
    let content: string;
    let uri: string;

    if (params.textDocument) {
      const doc = this.openFiles.get(params.textDocument.uri);
      if (!doc) throw new Error('Document not open');
      content = doc.content;
      uri = doc.uri;
    } else if (params.filePath) {
      content = fs.readFileSync(params.filePath, 'utf-8');
      uri = `file://${params.filePath}`;
    } else {
      throw new Error('Either textDocument or filePath required');
    }

    const data = await this.storage.load();
    const fragments = FragmentUtils.parseFragmentsWithLines(content);

    // Auto-discover and ensure all fragments exist in storage
    for (const fragment of fragments) {
      await this.storage.ensureFragment(fragment.id, fragment.currentContent);
    }

    let updatedContent = content;
    let appliedCount = 0;

    for (const fragment of fragments) {
      const fragmentData = await this.storage.getFragmentContent(fragment.id, data.activeVersion);
      if (fragmentData !== null && fragmentData !== fragment.currentContent) {
        updatedContent = FragmentUtils.replaceFragmentContent(updatedContent, fragment.id, fragmentData);
        appliedCount++;
      }
    }

    if (params.textDocument) {
      const doc = this.openFiles.get(uri)!;
      doc.content = updatedContent;
      doc.hasUnsavedChanges = true;
      doc.version++;
    } else {
      fs.writeFileSync(params.filePath!, updatedContent, 'utf-8');
    }

    return {
      success: true,
      newContent: updatedContent,
      appliedCount,
      hasChanges: appliedCount > 0
    };
  }

  async saveFragments(params: { textDocument?: { uri: string }; filePath?: string }) {
    let content: string;

    if (params.textDocument) {
      const doc = this.openFiles.get(params.textDocument.uri);
      if (!doc) throw new Error('Document not open');
      content = doc.content;
    } else if (params.filePath) {
      content = fs.readFileSync(params.filePath, 'utf-8');
    } else {
      throw new Error('Either textDocument or filePath required');
    }

    const data = await this.storage.load();
    const fragments = FragmentUtils.parseFragmentsWithLines(content);
    const nestedFragments = FragmentUtils.findNestedFragments(content);

    if (nestedFragments.length > 0) {
      return {
        success: false,
        fragmentsSaved: 0,
        activeVersion: data.activeVersion,
        issues: nestedFragments.map(nested => ({
          type: 'nested-fragment',
          fragmentId: nested.fragmentId,
          parentFragmentId: nested.parentFragmentId,
          startLine: nested.startLine,
          endLine: nested.endLine,
          message: `Fragment @${nested.fragmentId} is nested inside fragment @${nested.parentFragmentId}. Nested fragments are not supported.`
        }))
      };
    }

    // Auto-discover and ensure all fragments exist in storage
    for (const fragment of fragments) {
      await this.storage.ensureFragment(fragment.id, fragment.currentContent);
    }

    let savedCount = 0;
    for (const fragment of fragments) {
      await this.storage.updateFragment(fragment.id, data.activeVersion, fragment.currentContent);
      savedCount++;
    }

    return {
      success: true,
      activeVersion: data.activeVersion,
      fragmentsSaved: savedCount
    };
  }

  async switchVersion(params: { version: string }) {
    console.error(`[Server] Switching to version: ${params.version}`);
    console.error(`[Server] Open files: ${Array.from(this.openFiles.keys())}`);

    await this.storage.switchVersion(params.version);

    const results = [];
    for (const [uri, doc] of this.openFiles.entries()) {
      console.error(`[Server] Applying fragments to: ${uri}`);
      try {
        const result = await this.applyFragments({ textDocument: { uri } });
        results.push({ uri, result });
        console.error(`[Server] Applied ${result.appliedCount} fragments to ${uri}`);
      } catch (error) {
        console.error(`[Server] Error applying fragments to ${uri}:`, error);
        results.push({ uri, error: error instanceof Error ? error.message : String(error) });
      }
    }

    console.error(`[Server] Switch complete. Updated ${results.length} documents`);
    return {
      success: true,
      version: params.version,
      updatedDocuments: results
    };
  }

  async generateMarker(params: { languageId: string; lineContent?: string; indentation?: string }) {
    const { languageId, lineContent, indentation } = params;

    const markerResult = FragmentUtils.generateMarkerInsertion({
      languageId,
      lineContent: lineContent || '',
      indentation: indentation || ''
    });

    return {
      success: true,
      fragmentId: markerResult.fragmentId,
      markerText: markerResult.markerText,
      insertPosition: markerResult.insertPosition
    };
  }

  async getVersion() {
    const data = await this.storage.load();
    if (data) {
      return {
        activeVersion: data.activeVersion,
        availableVersions: data.availableVersions,
        initialized: true
      };
    } else {
      return {
        activeVersion: 'public',
        availableVersions: ['public', 'private'],
        initialized: false
      };
    }
  }

  async getFragmentPositions(params: { textDocument: { uri: string }; line: number }) {
    const doc = this.openFiles.get(params.textDocument.uri);
    if (!doc) throw new Error('Document not open');

    const lines = doc.content.split('\n');
    const lineContent = lines[params.line];

    if (!lineContent) {
      return { success: true, markerLines: [] };
    }

    // Check if this line is a fragment marker
    const startMatch = lineContent.match(/(.*)YOUR CODE: @([^\s]+) ====/);
    const endMatch = lineContent.includes('==== END YOUR CODE ====');

    if (startMatch) {
      // Find the matching end marker
      const fragmentId = startMatch[2];
      let endLine = -1;

      for (let i = params.line + 1; i < lines.length; i++) {
        if (lines[i].includes('==== END YOUR CODE ====')) {
          endLine = i;
          break;
        }
      }

      if (endLine !== -1) {
        return {
          success: true,
          markerLines: [
            {
              line: params.line,
              isStartMarker: true,
              isEndMarker: false,
              fragmentId: fragmentId
            },
            {
              line: endLine,
              isStartMarker: false,
              isEndMarker: true,
              fragmentId: fragmentId
            }
          ]
        };
      }
    } else if (endMatch) {
      // Find the matching start marker
      let startLine = -1;
      let fragmentId = null;

      for (let i = params.line - 1; i >= 0; i--) {
        const match = lines[i].match(/(.*)YOUR CODE: @([^\s]+) ====/);
        if (match) {
          startLine = i;
          fragmentId = match[2];
          break;
        }
      }

      if (startLine !== -1) {
        return {
          success: true,
          markerLines: [
            {
              line: startLine,
              isStartMarker: true,
              isEndMarker: false,
              fragmentId: fragmentId
            },
            {
              line: params.line,
              isStartMarker: false,
              isEndMarker: true,
              fragmentId: fragmentId
            }
          ]
        };
      }
    }

    return { success: true, markerLines: [] };
  }

  async getAllFragmentRanges(params: { textDocument: { uri: string } }) {
    const doc = this.openFiles.get(params.textDocument.uri);
    if (!doc) throw new Error('Document not open');

    const fragments = FragmentUtils.parseFragmentsWithLines(doc.content);

    return {
      success: true,
      fragments: fragments.map(fragment => ({
        id: fragment.id,
        startLine: fragment.startLine,
        endLine: fragment.endLine
      }))
    };
  }

  async init(params: { versions?: string[]; activeVersion?: string }) {
    const { versions = ['public', 'private'], activeVersion = 'public' } = params;
    await this.storage.initialize(versions, activeVersion);
    return { success: true, message: 'Fragments initialized successfully' };
  }
}

// Main entry point when run as standalone server
async function main() {
  const projectRoot = process.cwd();
  const storageFile = path.join(projectRoot, '.fragments');
  const server = new FragmentsServer(storageFile);

  console.error('Starting fragments server...');
  await server.start();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
