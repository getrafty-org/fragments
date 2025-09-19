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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
class FragmentsLanguageClient {
    serverProcess = null;
    requestId = 0;
    pendingRequests = new Map();
    operationQueue = new Map();
    async start() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }
        // Start fragments server
        const serverPath = path.join(workspaceFolder.uri.fsPath, 'cli', 'dist', 'server.js');
        this.serverProcess = (0, child_process_1.spawn)('node', [serverPath], {
            stdio: ['pipe', 'pipe', 'inherit'],
            cwd: workspaceFolder.uri.fsPath
        });
        // Handle responses
        this.serverProcess.stdout?.on('data', (data) => {
            const lines = data.toString().split('\n').filter((line) => line.trim());
            for (const line of lines) {
                try {
                    const response = JSON.parse(line);
                    this.handleResponse(response);
                }
                catch (error) {
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
    async sendRequest(method, params) {
        if (!this.serverProcess) {
            throw new Error('Fragments server not running');
        }
        const id = ++this.requestId;
        const request = { id, method, params };
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
    handleResponse(response) {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
                pending.reject(new Error(response.error.message));
            }
            else {
                pending.resolve(response.result);
            }
        }
    }
    // Serialize operations per document to avoid race conditions
    async executeForDocument(documentUri, operation) {
        const key = documentUri;
        if (this.operationQueue.has(key)) {
            await this.operationQueue.get(key);
        }
        const promise = operation();
        this.operationQueue.set(key, promise);
        try {
            const result = await promise;
            return result;
        }
        finally {
            this.operationQueue.delete(key);
        }
    }
    // Document lifecycle methods
    async onDocumentOpen(document) {
        await this.sendRequest('textDocument/didOpen', {
            textDocument: {
                uri: document.uri.toString(),
                text: document.getText(),
                version: document.version
            }
        });
    }
    async onDocumentChange(document) {
        await this.sendRequest('textDocument/didChange', {
            textDocument: {
                uri: document.uri.toString(),
                version: document.version
            },
            contentChanges: [{ text: document.getText() }]
        });
    }
    async onDocumentClose(document) {
        await this.sendRequest('textDocument/didClose', {
            textDocument: { uri: document.uri.toString() }
        });
    }
    // Fragment operations
    async applyFragments(document) {
        return this.executeForDocument(document.uri.toString(), async () => {
            const result = await this.sendRequest('fragments/apply', {
                textDocument: { uri: document.uri.toString() }
            });
            if (result.hasChanges) {
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
                edit.replace(document.uri, fullRange, result.newContent);
                await vscode.workspace.applyEdit(edit);
            }
            return result;
        });
    }
    async saveFragments(document) {
        return this.executeForDocument(document.uri.toString(), async () => {
            return this.sendRequest('fragments/save', {
                textDocument: { uri: document.uri.toString() }
            });
        });
    }
    async switchVersion(version) {
        console.log(`[Client] Switching to version: ${version}`);
        const result = await this.sendRequest('fragments/switchVersion', { version });
        console.log(`[Client] Switch result:`, result);
        return result;
    }
    async getVersion() {
        return this.sendRequest('fragments/getVersion', {});
    }
    async generateMarker(languageId, lineContent, indentation) {
        return this.sendRequest('fragments/generateMarker', {
            languageId,
            lineContent,
            indentation
        });
    }
    async getFragmentPositions(document, line) {
        return this.sendRequest('fragments/getFragmentPositions', {
            textDocument: { uri: document.uri.toString() },
            line: line
        });
    }
    async getAllFragmentRanges(document) {
        return this.sendRequest('fragments/getAllFragmentRanges', {
            textDocument: { uri: document.uri.toString() }
        });
    }
}
let fragmentsClient;
let statusBarItem;
let fragmentHoverDecorationType;
let fragmentDiagnostics;
async function activate(context) {
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
        isWholeLine: false
    });
    context.subscriptions.push(fragmentHoverDecorationType);
    // Diagnostic collection for fragment issues
    fragmentDiagnostics = vscode.languages.createDiagnosticCollection('fragments');
    context.subscriptions.push(fragmentDiagnostics);
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
        }
        catch (error) {
            console.warn(`Failed to apply fragments to already open document ${document.fileName}:`, error);
        }
    }
    // Helper function to determine if file should be processed
    function shouldProcessFile(document) {
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
            }
            else {
                statusBarItem.text = `$(versions) fragments`;
                statusBarItem.tooltip = 'Fragments not initialized. Click to initialize.';
                statusBarItem.show();
            }
        }
        catch (error) {
            statusBarItem.text = `$(error) fragments`;
            statusBarItem.tooltip = 'Error getting fragments version';
            statusBarItem.show();
        }
    }
    // Function to handle cursor position changes for marker hover effect
    let currentHoveredMarker = null;
    async function handleCursorPositionChange(event) {
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
            if (result.success && result.markerRanges && result.markerRanges.length > 0) {
                const markerRanges = result.markerRanges.map((markerRange) => new vscode.Range(new vscode.Position(markerRange.startLine, markerRange.startCharacter ?? 0), new vscode.Position(markerRange.endLine, markerRange.endCharacter ?? editor.document.lineAt(markerRange.endLine).text.length)));
                editor.setDecorations(fragmentHoverDecorationType, markerRanges);
                currentHoveredMarker = { editor, line: currentLine };
            }
            else if (currentHoveredMarker && currentHoveredMarker.line === currentLine) {
                // Clear highlight if we're no longer on a marker line
                editor.setDecorations(fragmentHoverDecorationType, []);
                currentHoveredMarker = null;
            }
        }
        catch (error) {
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
            }
            catch (error) {
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
            fragmentDiagnostics.delete(document.uri);
        }
    });
    const onDocumentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (shouldProcessFile(document)) {
            try {
                const result = await fragmentsClient.saveFragments(document);
                if (result && result.issues && result.issues.length > 0) {
                    const diagnostics = result.issues.map((issue) => {
                        const startLine = Math.min(issue.startLine ?? 0, document.lineCount - 1);
                        const endLine = Math.min(issue.endLine ?? startLine, document.lineCount - 1);
                        const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, document.lineAt(endLine).text.length));
                        return new vscode.Diagnostic(range, issue.message || 'Nested fragments are not supported.', vscode.DiagnosticSeverity.Error);
                    });
                    fragmentDiagnostics.set(document.uri, diagnostics);
                    vscode.window.showErrorMessage('Nested fragments are not supported. Remove nested fragment markers and save again.');
                    return;
                }
                fragmentDiagnostics.delete(document.uri);
                if (result.fragmentsSaved > 0) {
                    vscode.window.setStatusBarMessage(`Saved ${result.fragmentsSaved} fragments to ${result.activeVersion}`, 3000);
                    // Update status bar in case version changed
                    await updateStatusBar();
                }
            }
            catch (error) {
                fragmentDiagnostics.delete(document.uri);
                console.warn(`Failed to save fragments for ${document.fileName}:`, error);
            }
        }
    });
    // Commands
    const getVersionCommand = vscode.commands.registerCommand('fragments.getVersion', async () => {
        try {
            const result = await fragmentsClient.getVersion();
            vscode.window.showInformationMessage(`Active version: ${result.activeVersion}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
    const listVersionsCommand = vscode.commands.registerCommand('fragments.listVersions', async () => {
        try {
            const result = await fragmentsClient.getVersion();
            if (result && result.availableVersions) {
                const versionList = result.availableVersions
                    .map((v) => `${v}${v === result.activeVersion ? ' (active)' : ''}`)
                    .join('\n');
                vscode.window.showInformationMessage(`Available versions:\n${versionList}`, { modal: true });
            }
            else {
                vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
            }
        }
        catch (error) {
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
            const result = await fragmentsClient.generateMarker(document.languageId, lineContent, indentation);
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
        }
        catch (error) {
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
                const action = await vscode.window.showWarningMessage(`You have unsaved changes in: ${fileNames}. Save before switching versions?`, 'Save and Switch', 'Cancel');
                if (action === 'Save and Switch') {
                    // Save all unsaved documents
                    for (const doc of unsavedDocs) {
                        await doc.save();
                    }
                }
                else {
                    return; // User cancelled
                }
            }
            const versionData = await fragmentsClient.getVersion();
            if (!versionData || !versionData.availableVersions) {
                vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
                return;
            }
            const quickPickItems = versionData.availableVersions.map((v) => ({
                label: v,
                description: '',
                detail: v === versionData.activeVersion ? 'Currently active' : '',
                version: v
            }));
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select version to switch to',
                title: `Current version: ${versionData.activeVersion}`
            });
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
                    }
                    catch (error) {
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error switching version: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
    // Folding Range Provider for fragments
    const fragmentsFoldingProvider = {
        async provideFoldingRanges(document) {
            if (!shouldProcessFile(document)) {
                return [];
            }
            try {
                const result = await fragmentsClient.getAllFragmentRanges(document);
                if (result.success && result.fragments) {
                    return result.fragments.map((fragment) => new vscode.FoldingRange(fragment.startLine, fragment.endLine, vscode.FoldingRangeKind.Region));
                }
            }
            catch (error) {
                // Silently ignore errors
            }
            return [];
        }
    };
    // Register folding provider for all supported languages
    const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'dart', 'sql', 'html', 'css', 'scss', 'less', 'vue', 'svelte'];
    const foldingProviderDisposable = vscode.languages.registerFoldingRangeProvider(codeLanguages.map(lang => ({ language: lang })), fragmentsFoldingProvider);
    // Register cursor position change handler for hover effect
    const onSelectionChange = vscode.window.onDidChangeTextEditorSelection(handleCursorPositionChange);
    // Register everything
    context.subscriptions.push(onDocumentOpen, onDocumentChange, onDocumentClose, onDocumentSave, onSelectionChange, foldingProviderDisposable, getVersionCommand, listVersionsCommand, insertMarkerCommand, switchVersionCommand);
}
async function deactivate() {
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
//# sourceMappingURL=extension.js.map