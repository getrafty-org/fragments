import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

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

class FragmentsLanguageClient {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();
  private operationQueue = new Map<string, Promise<any>>();

  async start() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder found');
    }

    // Start fragments server
    const serverPath = path.join(workspaceFolder.uri.fsPath, 'cli', 'dist', 'server.js');
    this.serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: workspaceFolder.uri.fsPath
    });

    // Handle responses
    this.serverProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          console.error('Failed to parse server response:', line);
        }
      }
    });

    this.serverProcess.on('error', (error) => {
      console.error('Fragments server error:', error);
    });

    this.serverProcess.on('exit', (code) => {
      console.error('Fragments server exited with code:', code);
      this.serverProcess = null;
    });
  }

  async stop() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.serverProcess) {
      throw new Error('Fragments server not running');
    }

    const id = ++this.requestId;
    const request: FragmentRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.serverProcess?.stdin?.write(JSON.stringify(request) + '\n');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  private handleResponse(response: FragmentResponse) {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  // Serialize operations per document to avoid race conditions
  private async executeForDocument(documentUri: string, operation: () => Promise<any>): Promise<any> {
    const key = documentUri;

    if (this.operationQueue.has(key)) {
      await this.operationQueue.get(key);
    }

    const promise = operation();
    this.operationQueue.set(key, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.operationQueue.delete(key);
    }
  }

  // Document lifecycle methods
  async onDocumentOpen(document: vscode.TextDocument) {
    await this.sendRequest('textDocument/didOpen', {
      textDocument: {
        uri: document.uri.toString(),
        text: document.getText(),
        version: document.version
      }
    });
  }

  async onDocumentChange(document: vscode.TextDocument) {
    await this.sendRequest('textDocument/didChange', {
      textDocument: {
        uri: document.uri.toString(),
        version: document.version
      },
      contentChanges: [{ text: document.getText() }]
    });
  }

  async onDocumentClose(document: vscode.TextDocument) {
    await this.sendRequest('textDocument/didClose', {
      textDocument: { uri: document.uri.toString() }
    });
  }

  // Fragment operations
  async applyFragments(document: vscode.TextDocument) {
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

  async saveFragments(document: vscode.TextDocument) {
    return this.executeForDocument(document.uri.toString(), async () => {
      return this.sendRequest('fragments/save', {
        textDocument: { uri: document.uri.toString() }
      });
    });
  }

  async switchVersion(version: string) {
    console.log(`[Client] Switching to version: ${version}`);
    const result = await this.sendRequest('fragments/switchVersion', { version });
    console.log(`[Client] Switch result:`, result);
    return result;
  }

  async getVersion() {
    return this.sendRequest('fragments/getVersion', {});
  }

  async generateMarker(languageId: string, lineContent: string, indentation: string) {
    return this.sendRequest('fragments/generateMarker', {
      languageId,
      lineContent,
      indentation
    });
  }

  async getFragmentPositions(document: vscode.TextDocument, line: number) {
    return this.sendRequest('fragments/getFragmentPositions', {
      textDocument: { uri: document.uri.toString() },
      line: line
    });
  }

  async getAllFragmentRanges(document: vscode.TextDocument) {
    return this.sendRequest('fragments/getAllFragmentRanges', {
      textDocument: { uri: document.uri.toString() }
    });
  }
}

let fragmentsClient: FragmentsLanguageClient;
let statusBarItem: vscode.StatusBarItem;
let fragmentHoverDecorationType: vscode.TextEditorDecorationType;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize fragments client
  fragmentsClient = new FragmentsLanguageClient();
  await fragmentsClient.start();

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'fragments.switchVersion';
  context.subscriptions.push(statusBarItem);

  // Create decoration type for fragment marker hover (full line highlight)
  fragmentHoverDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editorHoverWidget.border'),
    borderRadius: '3px',
    isWholeLine: true
  });
  context.subscriptions.push(fragmentHoverDecorationType);

  // Update status bar with current version
  await updateStatusBar();

  // Apply fragments to already open documents
  const alreadyOpenDocuments = vscode.workspace.textDocuments.filter(shouldProcessFile);
  for (const document of alreadyOpenDocuments) {
    try {
      await fragmentsClient.onDocumentOpen(document);
      const result = await fragmentsClient.applyFragments(document);
      if (result.hasChanges) {
        await document.save();
      }
    } catch (error) {
      console.warn(`Failed to apply fragments to already open document ${document.fileName}:`, error);
    }
  }

  // Helper function to determine if file should be processed
  function shouldProcessFile(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file' || document.isUntitled) {
      return false;
    }

    const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.dart', '.sql', '.html', '.css', '.scss', '.less', '.vue', '.svelte'];
    const fileExtension = document.fileName.toLowerCase().substring(document.fileName.lastIndexOf('.'));
    return codeExtensions.includes(fileExtension);
  }

  // Function to update status bar with current version
  async function updateStatusBar() {
    try {
      const versionData = await fragmentsClient.getVersion();
      if (versionData && versionData.activeVersion) {
        statusBarItem.text = `$(versions) ${versionData.activeVersion}`;
        statusBarItem.tooltip = `Fragments version: ${versionData.activeVersion}. Click to switch versions.`;
        statusBarItem.show();
      } else {
        statusBarItem.text = `$(versions) fragments`;
        statusBarItem.tooltip = 'Fragments not initialized. Click to initialize.';
        statusBarItem.show();
      }
    } catch (error) {
      statusBarItem.text = `$(error) fragments`;
      statusBarItem.tooltip = 'Error getting fragments version';
      statusBarItem.show();
    }
  }

  // Function to handle cursor position changes for marker hover effect
  let currentHoveredMarker: { editor: vscode.TextEditor; line: number } | null = null;

  async function handleCursorPositionChange(event: vscode.TextEditorSelectionChangeEvent) {
    const editor = event.textEditor;
    if (!shouldProcessFile(editor.document)) {
      return;
    }

    const position = editor.selection.active;
    const currentLine = position.line;

    try {
      // Clear previous highlight if we moved to a different line
      if (currentHoveredMarker &&
          (currentHoveredMarker.editor !== editor || currentHoveredMarker.line !== currentLine)) {
        currentHoveredMarker.editor.setDecorations(fragmentHoverDecorationType, []);
        currentHoveredMarker = null;
      }

      // Check if current line is a fragment marker
      const result = await fragmentsClient.getFragmentPositions(editor.document, currentLine);
      if (result.success && result.markerLines && result.markerLines.length > 0) {
        // Apply highlight to all marker lines (both start and end)
        const ranges = result.markerLines.map((markerLine: any) =>
          new vscode.Range(
            new vscode.Position(markerLine.line, 0),
            new vscode.Position(markerLine.line, editor.document.lineAt(markerLine.line).text.length)
          )
        );

        editor.setDecorations(fragmentHoverDecorationType, ranges);
        currentHoveredMarker = { editor, line: currentLine };
      } else if (currentHoveredMarker && currentHoveredMarker.line === currentLine) {
        // Clear highlight if we're no longer on a marker line
        editor.setDecorations(fragmentHoverDecorationType, []);
        currentHoveredMarker = null;
      }
    } catch (error) {
      // Silently ignore errors for hover functionality
    }
  }

  // Document lifecycle events
  const onDocumentOpen = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (shouldProcessFile(document)) {
      await fragmentsClient.onDocumentOpen(document);

      // Apply fragments to ensure the file content matches the active version
      try {
        const result = await fragmentsClient.applyFragments(document);
        if (result.hasChanges) {
          // Auto-save the document after applying changes
          await document.save();
        }
      } catch (error) {
        console.warn(`Failed to apply fragments on document open for ${document.fileName}:`, error);
      }
    }
  });

  const onDocumentChange = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (shouldProcessFile(event.document)) {
      await fragmentsClient.onDocumentChange(event.document);
    }
  });

  const onDocumentClose = vscode.workspace.onDidCloseTextDocument(async (document) => {
    if (shouldProcessFile(document)) {
      await fragmentsClient.onDocumentClose(document);
    }
  });

  const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (shouldProcessFile(document)) {
      try {
        const result = await fragmentsClient.saveFragments(document);
        if (result.fragmentsSaved > 0) {
          vscode.window.setStatusBarMessage(
            `Saved ${result.fragmentsSaved} fragments to ${result.activeVersion}`,
            3000
          );
          // Update status bar in case version changed
          await updateStatusBar();
        }
      } catch (error) {
        console.warn(`Failed to save fragments for ${document.fileName}:`, error);
      }
    }
  });

  // Commands
  const getVersionCommand = vscode.commands.registerCommand('fragments.getVersion', async () => {
    try {
      const result = await fragmentsClient.getVersion();
      vscode.window.showInformationMessage(`Active version: ${result.activeVersion}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  const listVersionsCommand = vscode.commands.registerCommand('fragments.listVersions', async () => {
    try {
      const result = await fragmentsClient.getVersion();
      if (result && result.availableVersions) {
        const versionList = result.availableVersions
          .map((v: string) => `${v}${v === result.activeVersion ? ' (active)' : ''}`)
          .join('\n');

        vscode.window.showInformationMessage(
          `Available versions:\n${versionList}`,
          { modal: true }
        );
      } else {
        vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  const insertMarkerCommand = vscode.commands.registerCommand('fragments.insertMarker', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    try {
      const document = editor.document;
      const selection = editor.selection;
      const position = selection.active;

      // Get current line content and indentation
      const lineContent = document.lineAt(position.line).text;
      const indentationMatch = lineContent.match(/^(\s*)/);
      const indentation = indentationMatch ? indentationMatch[1] : '';

      const result = await fragmentsClient.generateMarker(
        document.languageId,
        lineContent,
        indentation
      );

      if (result.success) {
        // Insert the fragment marker
        const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length);
        await editor.edit(editBuilder => {
          editBuilder.insert(lineEndPosition, '\n' + result.markerText + '\n');
        });

        // Position cursor between the markers
        const newPosition = new vscode.Position(position.line + 2, indentation.length);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        vscode.window.showInformationMessage(`Fragment marker inserted: @${result.fragmentId}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error inserting fragment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  const switchVersionCommand = vscode.commands.registerCommand('fragments.switchVersion', async () => {
    try {
      // Check for unsaved changes in fragment-containing files
      const openDocuments = vscode.workspace.textDocuments.filter(shouldProcessFile);
      const unsavedDocs = openDocuments.filter(doc => doc.isDirty);

      if (unsavedDocs.length > 0) {
        const fileNames = unsavedDocs.map(doc => doc.fileName.split('/').pop()).join(', ');
        const action = await vscode.window.showWarningMessage(
          `You have unsaved changes in: ${fileNames}. Save before switching versions?`,
          'Save and Switch',
          'Cancel'
        );

        if (action === 'Save and Switch') {
          // Save all unsaved documents
          for (const doc of unsavedDocs) {
            await doc.save();
          }
        } else {
          return; // User cancelled
        }
      }

      const versionData = await fragmentsClient.getVersion();
      if (!versionData || !versionData.availableVersions) {
        vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
        return;
      }

      const quickPickItems = versionData.availableVersions.map((v: string) => ({
        label: v,
        description: '',
        detail: v === versionData.activeVersion ? 'Currently active' : '',
        version: v
      }));

      const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select version to switch to',
        title: `Current version: ${versionData.activeVersion}`
      }) as { label: string; description: string; detail: string; version: string } | undefined;

      if (!selectedItem) {
        return;
      }

      if (selectedItem.version === versionData.activeVersion) {
        vscode.window.showInformationMessage(`Already on version '${selectedItem.version}'`);
        return;
      }

      const result = await fragmentsClient.switchVersion(selectedItem.version);

      if (result.success) {
        // Apply fragments to all currently open documents to show the new version content
        let appliedCount = 0;

        for (const document of openDocuments) {
          try {
            // Refresh the server's document state with current content before applying fragments
            await fragmentsClient.onDocumentChange(document);

            const applyResult = await fragmentsClient.applyFragments(document);
            if (applyResult.hasChanges) {
              appliedCount++;
              // Auto-save the document after applying changes
              await document.save();
            }
          } catch (error) {
            console.warn(`Failed to apply fragments to ${document.fileName}:`, error);
          }
        }

        const updatedCount = result.updatedDocuments?.length || 0;
        const filesMsg = updatedCount > 0 ? ` (${updatedCount} files updated)` : '';
        const appliedMsg = appliedCount > 0 ? ` ${appliedCount} open files refreshed.` : '';
        vscode.window.showInformationMessage(`Switched to version '${selectedItem.version}'${filesMsg}.${appliedMsg}`);

        // Update status bar to reflect new version
        await updateStatusBar();
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error switching version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  // Folding Range Provider for fragments
  const fragmentsFoldingProvider: vscode.FoldingRangeProvider = {
    async provideFoldingRanges(document: vscode.TextDocument): Promise<vscode.FoldingRange[]> {
      if (!shouldProcessFile(document)) {
        return [];
      }

      try {
        const result = await fragmentsClient.getAllFragmentRanges(document);
        if (result.success && result.fragments) {
          return result.fragments.map((fragment: any) =>
            new vscode.FoldingRange(
              fragment.startLine,
              fragment.endLine,
              vscode.FoldingRangeKind.Region
            )
          );
        }
      } catch (error) {
        // Silently ignore errors
      }

      return [];
    }
  };

  // Register folding provider for all supported languages
  const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'dart', 'sql', 'html', 'css', 'scss', 'less', 'vue', 'svelte'];
  const foldingProviderDisposable = vscode.languages.registerFoldingRangeProvider(
    codeLanguages.map(lang => ({ language: lang })),
    fragmentsFoldingProvider
  );

  // Register cursor position change handler for hover effect
  const onSelectionChange = vscode.window.onDidChangeTextEditorSelection(handleCursorPositionChange);

  // Register everything
  context.subscriptions.push(
    onDocumentOpen,
    onDocumentChange,
    onDocumentClose,
    onDocumentSave,
    onSelectionChange,
    foldingProviderDisposable,
    getVersionCommand,
    listVersionsCommand,
    insertMarkerCommand,
    switchVersionCommand
  );
}

export async function deactivate() {
  if (fragmentsClient) {
    await fragmentsClient.stop();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (fragmentHoverDecorationType) {
    fragmentHoverDecorationType.dispose();
  }
}