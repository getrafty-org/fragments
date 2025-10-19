#!/usr/bin/env node

import * as path from 'path';
import { FragmentStorage, Storage } from 'fgmpack-db';
import { DocumentManager } from './document_manager';
import { FragmentService } from './fragment_service';
import { WorkspaceFragmentLocator } from './fragment_file_locator';
import { MemoryRevisionState } from './revision_state';
import {
  AllRangesParams,
  ChangeVersionParams,
  DidPersistDocumentParams,
  DidChangeDocumentParams,
  DidCloseDocumentParams,
  DidOpenDocumentParams,
  FragmentHandlers,
  FragmentMethod,
  FragmentOperationResult,
  FragmentRequestMessage,
  FragmentResponseMessage,
  InsertMarkerParams,
  MarkerPositionsParams,
  PullFragmentsParams,
  PushFragmentsParams
} from 'fgmpack-protocol';

export class FragmentsServer {
  private readonly documents = new DocumentManager();
  private readonly storage: Storage;
  private readonly service: FragmentService;
  private readonly handlers: FragmentHandlers;

  constructor(storageFile: string) {
    const encryptionKey = process.env.FRAGMENTS_ENCRYPTION_KEY;
    this.storage = new FragmentStorage(storageFile);
    const workspaceRoot = process.cwd();
    const fileLocator = new WorkspaceFragmentLocator(workspaceRoot);
    const revisionState = new MemoryRevisionState();
    this.service = new FragmentService(
      this.documents,
      this.storage,
      fileLocator,
      revisionState
    );
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
      'frag.event.didOpenDocument': (params: DidOpenDocumentParams) => this.handleDidOpen(params),
      'frag.event.didChangeDocument': (params: DidChangeDocumentParams) => this.handleDidChange(params),
      'frag.event.didCloseDocument': (params: DidCloseDocumentParams) => this.handleDidClose(params),
      'frag.event.didPersistDocument': (params: DidPersistDocumentParams) =>
        Promise.resolve(this.service.acknowledgePersist(params)),
      'frag.action.pullFragments': (params: PullFragmentsParams) => this.service.pullFragments(params),
      'frag.action.pushFragments': (params: PushFragmentsParams) => this.service.pushFragments(params),
      'frag.action.changeVersion': (params: ChangeVersionParams) => this.handleChangeVersion(params),
      'frag.action.insertMarker': (params: InsertMarkerParams) => this.service.insertMarker(params),
      'frag.query.getVersion': () => this.service.getVersion(),
      'frag.query.getFragmentPositions': (params: MarkerPositionsParams) =>
        this.service.getFragmentPositions(params),
      'frag.query.getAllFragmentRanges': (params: AllRangesParams) =>
        this.service.getAllFragmentRanges(params)
    };
  }

  private async handleDidOpen(params: DidOpenDocumentParams): Promise<FragmentOperationResult> {
    const { uri, text, version } = params.textDocument;
    this.documents.open({ uri, content: text, version, hasUnsavedChanges: false });
    return { success: true };
  }

  private async handleDidChange(params: DidChangeDocumentParams): Promise<FragmentOperationResult> {
    const { uri, version } = params.textDocument;
    const newContent = params.contentChanges[0].text;
    this.documents.applyChange(uri, newContent, version);
    return { success: true };
  }

  private async handleDidClose(params: DidCloseDocumentParams): Promise<FragmentOperationResult> {
    this.documents.close(params.textDocument.uri);
    return { success: true };
  }

  private async handleChangeVersion(params: ChangeVersionParams) {
    console.error(`[Server] Switching to version: ${params.version}`);
    const openUris = this.documents.entries().map(doc => doc.uri);
    console.error(`[Server] Open files: ${openUris}`);

    const result = await this.service.changeVersion(params);
    console.error(`[Server] Switch complete. Updated ${result.documents.length} documents`);
    return result;
  }
}

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
