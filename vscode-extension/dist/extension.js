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
const client_1 = require("./client");
const diagnosticsManager_1 = require("./services/diagnosticsManager");
const hoverHighlighter_1 = require("./services/hoverHighlighter");
const statusBarManager_1 = require("./services/statusBarManager");
const documentFilters_1 = require("./utils/documentFilters");
let fragmentsClient;
let diagnosticsManager;
let hoverHighlighter;
let statusBarManager;
async function activate(context) {
    fragmentsClient = new client_1.FragmentsLanguageClient(context.extensionUri.fsPath);
    diagnosticsManager = new diagnosticsManager_1.FragmentDiagnosticsManager();
    hoverHighlighter = new hoverHighlighter_1.FragmentHoverHighlighter(fragmentsClient);
    statusBarManager = new statusBarManager_1.FragmentStatusBarManager(fragmentsClient);
    context.subscriptions.push(fragmentsClient, diagnosticsManager, hoverHighlighter, statusBarManager);
    await fragmentsClient.start();
    hoverHighlighter.register();
    await statusBarManager.initialize();
    await pullFragmentsForOpenDocuments();
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(handleDocumentOpen), vscode.workspace.onDidChangeTextDocument(handleDocumentChange), vscode.workspace.onDidCloseTextDocument(handleDocumentClose), vscode.workspace.onDidSaveTextDocument(handleDocumentSave));
    context.subscriptions.push(registerGetVersionCommand(), registerListVersionsCommand(), registerInsertMarkerCommand(), registerSwitchVersionCommand());
}
async function deactivate() {
    if (fragmentsClient) {
        await fragmentsClient.stop();
    }
}
async function pullFragmentsForOpenDocuments() {
    const documents = vscode.workspace.textDocuments.filter(documentFilters_1.isProcessableDocument);
    for (const document of documents) {
        try {
            await fragmentsClient.onDocumentOpen(document);
            const result = await fragmentsClient.pullFragments(document);
            if (result.hasChanges) {
                await document.save();
            }
        }
        catch (error) {
            console.warn(`Failed to apply fragments to already open document ${document.fileName}:`, error);
        }
    }
}
async function handleDocumentOpen(document) {
    if (!(0, documentFilters_1.isProcessableDocument)(document)) {
        return;
    }
    await fragmentsClient.onDocumentOpen(document);
    try {
        const result = await fragmentsClient.pullFragments(document);
        if (result.hasChanges) {
            await document.save();
        }
    }
    catch (error) {
        console.warn(`Failed to apply fragments on document open for ${document.fileName}:`, error);
    }
}
async function handleDocumentChange(event) {
    if (!(0, documentFilters_1.isProcessableDocument)(event.document)) {
        return;
    }
    try {
        await fragmentsClient.onDocumentChange(event.document);
    }
    catch (error) {
        console.warn(`Failed to process document change for ${event.document.fileName}:`, error);
    }
}
async function handleDocumentClose(document) {
    if (!(0, documentFilters_1.isProcessableDocument)(document)) {
        return;
    }
    try {
        await fragmentsClient.onDocumentClose(document);
    }
    catch (error) {
        console.warn(`Failed to process document close for ${document.fileName}:`, error);
    }
    diagnosticsManager.clear(document);
}
async function handleDocumentSave(document) {
    if (!(0, documentFilters_1.isProcessableDocument)(document)) {
        return;
    }
    try {
        const result = await fragmentsClient.pushFragments(document);
        if (!result.success && result.issues && result.issues.length > 0) {
            diagnosticsManager.setIssues(document, result.issues);
            vscode.window.showErrorMessage('Nested fragments are not supported. Remove nested fragment markers and save again.');
            return;
        }
        diagnosticsManager.clear(document);
        if (result.success && result.fragmentsSaved > 0) {
            vscode.window.setStatusBarMessage(`Saved ${result.fragmentsSaved} fragments to ${result.activeVersion}`, 3000);
            await statusBarManager.refresh();
        }
    }
    catch (error) {
        diagnosticsManager.clear(document);
        console.warn(`Failed to save fragments for ${document.fileName}:`, error);
    }
}
function registerGetVersionCommand() {
    return vscode.commands.registerCommand('fragments.getVersion', async () => {
        try {
            const result = await fragmentsClient.getVersion();
            vscode.window.showInformationMessage(`Active version: ${result.activeVersion}`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}
function registerListVersionsCommand() {
    return vscode.commands.registerCommand('fragments.listVersions', async () => {
        try {
            const result = await fragmentsClient.getVersion();
            if (result && result.availableVersions) {
                const versionList = result.availableVersions
                    .map((v) => `${v}${v === result.activeVersion ? ' (active)' : ''}`)
                    .join('\n');
                vscode.window.showInformationMessage(`Available versions:\n${versionList}`);
            }
            else {
                vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}
function registerInsertMarkerCommand() {
    return vscode.commands.registerCommand('fragments.insertMarker', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }
        try {
            const document = editor.document;
            const selection = editor.selection;
            const position = selection.active;
            const lineContent = document.lineAt(position.line).text;
            const indentationMatch = lineContent.match(/^(\s*)/);
            const indentation = indentationMatch ? indentationMatch[1] : '';
            const result = await fragmentsClient.insertMarker(document.languageId, lineContent, indentation);
            if (result.success) {
                const lineEndPosition = new vscode.Position(position.line, lineContent.length);
                await editor.edit((editBuilder) => {
                    editBuilder.insert(lineEndPosition, '\n' + result.markerText + '\n');
                });
                const newPosition = new vscode.Position(position.line + 2, indentation.length);
                editor.selection = new vscode.Selection(newPosition, newPosition);
                vscode.window.showInformationMessage(`Fragment marker inserted: @${result.fragmentId}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error inserting fragment: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}
function registerSwitchVersionCommand() {
    return vscode.commands.registerCommand('fragments.switchVersion', async () => {
        try {
            const openDocuments = vscode.workspace.textDocuments.filter(documentFilters_1.isProcessableDocument);
            const unsavedDocs = openDocuments.filter((doc) => doc.isDirty);
            if (unsavedDocs.length > 0) {
                const fileNames = unsavedDocs
                    .map((doc) => doc.fileName.split('/').pop())
                    .join(', ');
                const action = await vscode.window.showWarningMessage(`You have unsaved changes in: ${fileNames}. Save before switching versions?`, 'Save and Switch', 'Cancel');
                if (action === 'Save and Switch') {
                    for (const doc of unsavedDocs) {
                        await doc.save();
                    }
                }
                else {
                    return;
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
            if (!selectedItem || selectedItem.version === versionData.activeVersion) {
                if (selectedItem) {
                    vscode.window.showInformationMessage(`Already on version '${selectedItem.version}'`);
                }
                return;
            }
            const result = await fragmentsClient.switchVersion(selectedItem.version);
            if (result.success) {
                const updatedCount = result.documents.length;
                const removedCount = result.removedUris.length;
                const summaryParts = [`Switched to version '${selectedItem.version}'`];
                if (updatedCount > 0) {
                    summaryParts.push(`${updatedCount} files updated`);
                }
                if (removedCount > 0) {
                    summaryParts.push(`${removedCount} files removed`);
                }
                vscode.window.showInformationMessage(summaryParts.join('; '));
                await statusBarManager.refresh();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error switching versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
}
//# sourceMappingURL=extension.js.map