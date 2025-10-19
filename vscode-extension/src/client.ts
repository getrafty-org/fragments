import * as vscode from 'vscode';
import { BinaryLocator } from './utils/binary_locator';
import { spawn, ChildProcess } from 'child_process';
import {
  FragmentAllRangesResult,
  FragmentChangeVersionResult,
  FragmentDocumentChange,
  FragmentMarkerRangesResult,
  FragmentMethod,
  FragmentRequestMessage,
  FragmentRequestParams,
  FragmentResponseMessage,
  FragmentResponseResults,
  FragmentVersionInfo,
  InsertMarkerResult,
  PullFragmentsResult,
  PushFragmentsResult
} from 'fgmpack-protocol';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class Client {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly operationQueue = new Map<string, Promise<unknown>>();
  private readonly binaryLocator: BinaryLocator;
  private responseBuffer = '';

  constructor(context: vscode.ExtensionContext) {
    this.binaryLocator = new BinaryLocator(context);
  }

  async start(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }

    const serverPath = await this.binaryLocator.locate();

    this.serverProcess = spawn(serverPath, ['--root', workspaceFolder.uri.fsPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: workspaceFolder.uri.fsPath
    });
    console.info("fgmpackd started")

    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      this.responseBuffer += data.toString();

      let newlineIndex;
      while ((newlineIndex = this.responseBuffer.indexOf('\n')) !== -1) {
        const line = this.responseBuffer.slice(0, newlineIndex);
        this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);

        if (line.trim()) {
          try {
            const response = JSON.parse(line) as FragmentResponseMessage;
            this.handleResponse(response);
          } catch (error) {
            console.error('Failed to parse server response:', line.substring(0, 200), error);
          }
        }
      }
    });

    this.serverProcess.on('error', (error: Error) => {
      console.error('Fragments server error:', error);
    });

    this.serverProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      console.error('Fragments server exited with code:', code, 'signal:', signal);
      this.serverProcess = null;
    });
  }

  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
      this.responseBuffer = '';
    }
  }

  async onDocumentOpen(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('frag.event.didOpenDocument', {
      textDocument: {
        uri: document.uri.toString(),
        text: document.getText(),
        version: document.version
      }
    });
  }

  async onDocumentChange(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('frag.event.didChangeDocument', {
      textDocument: {
        uri: document.uri.toString(),
        version: document.version
      },
      contentChanges: [{ text: document.getText() }]
    });
  }

  async onDocumentClose(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('frag.event.didCloseDocument', {
      textDocument: { uri: document.uri.toString() }
    });
  }

  async pullFragments(document: vscode.TextDocument): Promise<PullFragmentsResult> {
    return this.executeForDocument(document.uri.toString(), async () => {
      const result = await this.sendRequest('frag.action.pullFragments', {
        textDocument: { uri: document.uri.toString() }
      });

      if (result.hasChanges) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        edit.replace(document.uri, fullRange, result.newContent);
        await vscode.workspace.applyEdit(edit);
      }

      return result;
    });
  }

  async pushFragments(document: vscode.TextDocument): Promise<PushFragmentsResult> {
    return this.executeForDocument(document.uri.toString(), async () => {
      return this.sendRequest('frag.action.pushFragments', {
        textDocument: { uri: document.uri.toString() }
      });
    });
  }

  async switchVersion(version: string): Promise<FragmentChangeVersionResult> {
    console.log(`[Client] Changing to version: ${version}`);
    const result = await this.sendRequest('frag.action.changeVersion', { version });
    await this.applyDocumentChanges(result.documents);
    console.log('[Client] Change version result:', result);
    return result;
  }

  async getVersion(): Promise<FragmentVersionInfo> {
    return this.sendRequest('frag.query.getVersion', {});
  }

  async insertMarker(languageId: string, lineContent: string, indentation: string): Promise<InsertMarkerResult> {
    return this.sendRequest('frag.action.insertMarker', {
      languageId,
      lineContent,
      indentation
    });
  }

  async getFragmentPositions(document: vscode.TextDocument, line: number): Promise<FragmentMarkerRangesResult> {
    return this.sendRequest('frag.query.getFragmentPositions', {
      textDocument: { uri: document.uri.toString() },
      line
    });
  }

  async getAllFragmentRanges(document: vscode.TextDocument): Promise<FragmentAllRangesResult> {
    return this.sendRequest('frag.query.getAllFragmentRanges', {
      textDocument: { uri: document.uri.toString() }
    });
  }

  dispose(): void {
    void this.stop();
  }

  private async applyDocumentChanges(changes: FragmentDocumentChange[]): Promise<void> {
    for (const change of changes) {
      await this.executeForDocument(change.uri, async () => this.applyDocumentChange(change));
    }
  }

  private async applyDocumentChange(change: FragmentDocumentChange): Promise<void> {
    const targetUri = vscode.Uri.parse(change.uri);
    const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === change.uri);

    if (openDocument) {
      await this.applyOpenDocumentChange(openDocument, change.content);
    } else {
      await this.persistClosedDocument(targetUri, change.content);
    }

    await this.notifyDidPersist(change.uri, change.revision);
  }

  private async applyOpenDocumentChange(document: vscode.TextDocument, content: string): Promise<void> {
    if (document.getText() === content) {
      if (document.isDirty) {
        await document.save();
      }
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    edit.replace(document.uri, fullRange, content);

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`Failed to apply fragment update to ${document.uri.toString()}`);
    }

    const saved = await document.save();
    if (!saved) {
      throw new Error(`Failed to save fragment update to ${document.uri.toString()}`);
    }
  }

  private async persistClosedDocument(uri: vscode.Uri, content: string): Promise<void> {
    try {
      const existing = await vscode.workspace.fs.readFile(uri);
      const existingContent = Buffer.from(existing).toString('utf8');
      if (existingContent === content) {
        return;
      }
    } catch {
      // File may not exist yet; proceed with write.
    }

    const buffer = Buffer.from(content, 'utf8');
    await vscode.workspace.fs.writeFile(uri, buffer);
  }

  private async notifyDidPersist(uri: string, revision: number): Promise<void> {
    await this.sendRequest('frag.event.didPersistDocument', {
      uri,
      revision
    });
  }

  private async sendRequest<TMethod extends FragmentMethod>(
    method: TMethod,
    params: FragmentRequestParams[TMethod]
  ): Promise<FragmentResponseResults[TMethod]> {
    if (!this.serverProcess) {
      throw new Error('Fragments server not running');
    }

    const id = ++this.requestId;
    const request: FragmentRequestMessage<TMethod> = { id, method, params };

    return new Promise<FragmentResponseResults[TMethod]>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.serverProcess?.stdin?.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  private handleResponse(response: FragmentResponseMessage): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result as unknown);
    }
  }

  private async executeForDocument<T>(documentUri: string, operation: () => Promise<T>): Promise<T> {
    const inFlight = this.operationQueue.get(documentUri);
    if (inFlight) {
      await inFlight;
    }

    const promise = operation();
    this.operationQueue.set(documentUri, promise);

    try {
      return await promise;
    } finally {
      this.operationQueue.delete(documentUri);
    }
  }
}
