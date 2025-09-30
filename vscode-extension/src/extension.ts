import * as vscode from 'vscode';
import { Client } from './client';
import { FragmentDiagnosticsManager } from './services/diagnosticsManager';
import { FragmentHoverHighlighter } from './services/hoverHighlighter';
import { FragmentStatusBarManager } from './services/statusBarManager';
import {
  FragmentChangeVersionResult,
  FragmentVersionInfo,
  PushFragmentsResult,
  PullFragmentsResult
} from 'fgmpack-protocol';
import { isProcessableDocument } from './utils/documentFilters';

let client: Client;
let diagnosticsManager: FragmentDiagnosticsManager;
let hoverHighlighter: FragmentHoverHighlighter;
let statusBarManager: FragmentStatusBarManager;

export async function activate(context: vscode.ExtensionContext) {
  client = new Client(context);
  diagnosticsManager = new FragmentDiagnosticsManager();
  hoverHighlighter = new FragmentHoverHighlighter(client);
  statusBarManager = new FragmentStatusBarManager(client);

  context.subscriptions.push(client, diagnosticsManager, hoverHighlighter, statusBarManager);

  await client.init();
  await client.start();
  
  hoverHighlighter.register();
  await statusBarManager.initialize();

  await pullFragmentsForOpenDocuments();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(handleDocumentOpen),
    vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
    vscode.workspace.onDidCloseTextDocument(handleDocumentClose),
    vscode.workspace.onDidSaveTextDocument(handleDocumentSave)
  );

  context.subscriptions.push(
    registerGetVersionCommand(),
    registerListVersionsCommand(),
    registerInsertMarkerCommand(),
    registerSwitchVersionCommand()
  );
}

export async function deactivate() {
  if (client) {
    await client.stop();
  }
}

async function pullFragmentsForOpenDocuments() {
  const documents = vscode.workspace.textDocuments.filter(isProcessableDocument);
  for (const document of documents) {
    try {
      await client.onDocumentOpen(document);
      const result: PullFragmentsResult = await client.pullFragments(document);
      if (result.hasChanges) {
        await document.save();
      }
    } catch (error) {
      console.warn(`Failed to apply fragments to already open document ${document.fileName}:`, error);
    }
  }
}

async function handleDocumentOpen(document: vscode.TextDocument) {
  if (!isProcessableDocument(document)) {
    return;
  }

  await client.onDocumentOpen(document);

  try {
    const result: PullFragmentsResult = await client.pullFragments(document);
    if (result.hasChanges) {
      await document.save();
    }
  } catch (error) {
    console.warn(`Failed to apply fragments on document open for ${document.fileName}:`, error);
  }
}

async function handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
  if (!isProcessableDocument(event.document)) {
    return;
  }

  try {
    await client.onDocumentChange(event.document);
  } catch (error) {
    console.warn(`Failed to process document change for ${event.document.fileName}:`, error);
  }
}

async function handleDocumentClose(document: vscode.TextDocument) {
  if (!isProcessableDocument(document)) {
    return;
  }

  try {
    await client.onDocumentClose(document);
  } catch (error) {
    console.warn(`Failed to process document close for ${document.fileName}:`, error);
  }
  diagnosticsManager.clear(document);
}

async function handleDocumentSave(document: vscode.TextDocument) {
  if (!isProcessableDocument(document)) {
    return;
  }

  try {
    const result: PushFragmentsResult = await client.pushFragments(document);
    if (!result.success && result.issues && result.issues.length > 0) {
      diagnosticsManager.setIssues(document, result.issues);
      vscode.window.showErrorMessage(
        'Nested fragments are not supported. Remove nested fragment markers and save again.'
      );
      return;
    }

    diagnosticsManager.clear(document);

    if (result.success && result.fragmentsSaved > 0) {
      vscode.window.setStatusBarMessage(
        `Saved ${result.fragmentsSaved} fragments to ${result.activeVersion}`,
        3000
      );
      await statusBarManager.refresh();
    }
  } catch (error) {
    diagnosticsManager.clear(document);
    console.warn(`Failed to save fragments for ${document.fileName}:`, error);
  }
}

function registerGetVersionCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('fgmpack.getVersion', async () => {
    try {
      const result: FragmentVersionInfo = await client.getVersion();
      vscode.window.showInformationMessage(`Active version: ${result.activeVersion}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

function registerListVersionsCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('fgmpack.listVersions', async () => {
    try {
      const result: FragmentVersionInfo = await client.getVersion();
      if (result && result.availableVersions) {
        const versionList = result.availableVersions
          .map((v: string) => `${v}${v === result.activeVersion ? ' (active)' : ''}`)
          .join('\n');
        vscode.window.showInformationMessage(`Available versions:\n${versionList}`);
      } else {
        vscode.window.showWarningMessage('No versions found. Initialize fragments first.');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

function registerInsertMarkerCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('fgmpack.insertMarker', async () => {
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

      const result = await client.insertMarker(
        document.languageId,
        lineContent,
        indentation
      );

      if (result.success) {
        const lineEndPosition = new vscode.Position(position.line, lineContent.length);
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
          editBuilder.insert(lineEndPosition, '\n' + result.markerText + '\n');
        });

        const newPosition = new vscode.Position(position.line + 2, indentation.length);
        editor.selection = new vscode.Selection(newPosition, newPosition);

        vscode.window.showInformationMessage(`Fragment marker inserted: @${result.fragmentId}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error inserting fragment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}

function registerSwitchVersionCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('fgmpack.switchVersion', async () => {
    try {
      const openDocuments = vscode.workspace.textDocuments.filter(isProcessableDocument);
      const unsavedDocs = openDocuments.filter((doc: vscode.TextDocument) => doc.isDirty);

      if (unsavedDocs.length > 0) {
        const fileNames = unsavedDocs
          .map((doc: vscode.TextDocument) => doc.fileName.split('/').pop())
          .join(', ');
        const action = await vscode.window.showWarningMessage(
          `You have unsaved changes in: ${fileNames}. Save before switching versions?`,
          'Save and Switch',
          'Cancel'
        );

        if (action === 'Save and Switch') {
          for (const doc of unsavedDocs) {
            await doc.save();
          }
        } else {
          return;
        }
      }

      const versionData = await client.getVersion();
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

      if (!selectedItem || selectedItem.version === versionData.activeVersion) {
        if (selectedItem) {
          vscode.window.showInformationMessage(`Already on version '${selectedItem.version}'`);
        }
        return;
      }

      const result: FragmentChangeVersionResult = await client.switchVersion(selectedItem.version);

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
    } catch (error) {
      vscode.window.showErrorMessage(`Error switching versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });
}
