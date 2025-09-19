#!/usr/bin/env node

import * as path from 'path';
import { FragmentStorage, IFragmentStorage } from './storage';
import { DocumentManager } from './documentManager';
import { FragmentService } from './fragmentService';
import {
  ApplyFragmentsParams,
  FragmentHandlers,
  FragmentMethod,
  FragmentOperationResult,
  FragmentRequestMessage,
  FragmentResponseMessage,
  FragmentRequestParams,
  GenerateMarkerParams,
  SaveFragmentsParams,
  SwitchVersionParams,
  TextDocumentDidChangeParams,
  TextDocumentDidCloseParams,
  TextDocumentDidOpenParams
} from 'fragments-protocol';

export class FragmentsServer {
  private readonly documents = new DocumentManager();
  private readonly storage: IFragmentStorage;
  private readonly service: FragmentService;
  private readonly handlers: FragmentHandlers;

  constructor(storageFile: string) {
    this.storage = new FragmentStorage(storageFile);
    this.service = new FragmentService(this.documents, this.storage);
    this.handlers = this.createHandlers();
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
    let request: FragmentRequestMessage | null = null;
    try {
      request = JSON.parse(messageStr) as FragmentRequestMessage;
      const handler = this.handlers[request.method];
      const result = await handler(request.params as never);
      this.sendResponse({ id: request.id, result } as FragmentResponseMessage);
    } catch (error) {
      this.sendResponse({
        id: request?.id ?? 0,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private sendResponse(response: FragmentResponseMessage) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private createHandlers(): FragmentHandlers {
    return {
      'textDocument/didOpen': (params: TextDocumentDidOpenParams) => this.handleTextDocumentDidOpen(params),
      'textDocument/didChange': (params: TextDocumentDidChangeParams) => this.handleTextDocumentDidChange(params),
      'textDocument/didClose': (params: TextDocumentDidCloseParams) => this.handleTextDocumentDidClose(params),
      'fragments/apply': (params: ApplyFragmentsParams) => this.service.applyFragments(params),
      'fragments/save': (params: SaveFragmentsParams) => this.service.saveFragments(params),
      'fragments/switchVersion': (params: SwitchVersionParams) => this.handleSwitchVersion(params),
      'fragments/generateMarker': (params: GenerateMarkerParams) => this.service.generateMarker(params),
      'fragments/getVersion': () => this.service.getVersion(),
      'fragments/getFragmentPositions': (params: FragmentRequestParams['fragments/getFragmentPositions']) =>
        this.service.getFragmentPositions(params),
      'fragments/getAllFragmentRanges': (params: FragmentRequestParams['fragments/getAllFragmentRanges']) =>
        this.service.getAllFragmentRanges(params),
      'fragments/init': (params: FragmentRequestParams['fragments/init']) => this.service.init(params)
    };
  }

  // Document lifecycle handlers
  private async handleTextDocumentDidOpen(params: TextDocumentDidOpenParams): Promise<FragmentOperationResult> {
    const { uri, text, version } = params.textDocument;
    this.documents.open({ uri, content: text, version, hasUnsavedChanges: false });
    return { success: true };
  }

  private async handleTextDocumentDidChange(params: TextDocumentDidChangeParams): Promise<FragmentOperationResult> {
    const { uri, version } = params.textDocument;
    const newContent = params.contentChanges[0].text;
    this.documents.applyChange(uri, newContent, version);
    return { success: true };
  }

  private async handleTextDocumentDidClose(params: TextDocumentDidCloseParams): Promise<FragmentOperationResult> {
    this.documents.close(params.textDocument.uri);
    return { success: true };
  }

  private async handleSwitchVersion(params: SwitchVersionParams) {
    console.error(`[Server] Switching to version: ${params.version}`);
    const openUris = this.documents.entries().map(doc => doc.uri);
    console.error(`[Server] Open files: ${openUris}`);

    const result = await this.service.switchVersion(params);
    console.error(`[Server] Switch complete. Updated ${result.updatedDocuments.length} documents`);
    return result;
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
