import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  FragmentAllRangesResult,
  FragmentApplyResult,
  FragmentGenerateMarkerResult,
  FragmentMarkerRangesResult,
  FragmentMethod,
  FragmentRequestMessage,
  FragmentRequestParams,
  FragmentResponseMessage,
  FragmentResponseResults,
  FragmentSaveResult,
  FragmentSwitchVersionResult,
  FragmentVersionInfo
} from 'fragments-protocol';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class FragmentsLanguageClient {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly operationQueue = new Map<string, Promise<unknown>>();

  async start(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }

    const serverPath = path.join(workspaceFolder.uri.fsPath, 'language-server', 'dist', 'server.js');
    this.serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: workspaceFolder.uri.fsPath
    });

    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line) as FragmentResponseMessage;
          this.handleResponse(response);
        } catch (error) {
          console.error('Failed to parse server response:', line, error);
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
    }
  }

  async onDocumentOpen(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('textDocument/didOpen', {
      textDocument: {
        uri: document.uri.toString(),
        text: document.getText(),
        version: document.version
      }
    });
  }

  async onDocumentChange(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('textDocument/didChange', {
      textDocument: {
        uri: document.uri.toString(),
        version: document.version
      },
      contentChanges: [{ text: document.getText() }]
    });
  }

  async onDocumentClose(document: vscode.TextDocument): Promise<void> {
    await this.sendRequest('textDocument/didClose', {
      textDocument: { uri: document.uri.toString() }
    });
  }

  async applyFragments(document: vscode.TextDocument): Promise<FragmentApplyResult> {
    return this.executeForDocument(document.uri.toString(), async () => {
      const result = await this.sendRequest('fragments/apply', {
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

  async saveFragments(document: vscode.TextDocument): Promise<FragmentSaveResult> {
    return this.executeForDocument(document.uri.toString(), async () => {
      return this.sendRequest('fragments/save', {
        textDocument: { uri: document.uri.toString() }
      });
    });
  }

  async switchVersion(version: string): Promise<FragmentSwitchVersionResult> {
    console.log(`[Client] Switching to version: ${version}`);
    const result = await this.sendRequest('fragments/switchVersion', { version });
    console.log('[Client] Switch result:', result);
    return result;
  }

  async getVersion(): Promise<FragmentVersionInfo> {
    return this.sendRequest('fragments/getVersion', {});
  }

  async generateMarker(languageId: string, lineContent: string, indentation: string): Promise<FragmentGenerateMarkerResult> {
    return this.sendRequest('fragments/generateMarker', {
      languageId,
      lineContent,
      indentation
    });
  }

  async getFragmentPositions(document: vscode.TextDocument, line: number): Promise<FragmentMarkerRangesResult> {
    return this.sendRequest('fragments/getFragmentPositions', {
      textDocument: { uri: document.uri.toString() },
      line
    });
  }

  async getAllFragmentRanges(document: vscode.TextDocument): Promise<FragmentAllRangesResult> {
    return this.sendRequest('fragments/getAllFragmentRanges', {
      textDocument: { uri: document.uri.toString() }
    });
  }

  dispose(): void {
    void this.stop();
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
