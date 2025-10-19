import * as vscode from 'vscode';
import { Client } from '../client';
import { FragmentMarkerRange } from 'fgmpack-protocol';
import { isProcessableDocument } from '../utils/document_filters';

export class FragmentHoverHighlighter implements vscode.Disposable {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editorHoverWidget.border'),
    borderRadius: '3px',
    isWholeLine: false
  });

  private currentHover: { editor: vscode.TextEditor; line: number } | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly client: Client) {
    this.disposables.push(this.decorationType);
  }

  register(): void {
    this.disposables.push(vscode.window.onDidChangeTextEditorSelection(this.handleSelectionChange));
    this.disposables.push(vscode.workspace.onDidCloseTextDocument(this.clearDocumentDiagnostics));
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private handleSelectionChange = async (event: vscode.TextEditorSelectionChangeEvent) => {
    const editor = event.textEditor;
    if (!isProcessableDocument(editor.document)) {
      return;
    }

    const position = editor.selection.active;
    const currentLine = position.line;

    if (this.currentHover && (this.currentHover.editor !== editor || this.currentHover.line !== currentLine)) {
      this.clearHighlight(this.currentHover.editor);
      this.currentHover = null;
    }

    try {
      const result = await this.client.getFragmentPositions(editor.document, currentLine);
      if (result.success && result.markerRanges.length > 0) {
        const ranges = result.markerRanges.map((markerRange: FragmentMarkerRange) =>
          new vscode.Range(
            new vscode.Position(markerRange.startLine, markerRange.startCharacter ?? 0),
            new vscode.Position(
              markerRange.endLine,
              markerRange.endCharacter ?? editor.document.lineAt(markerRange.endLine).text.length
            )
          )
        );

        editor.setDecorations(this.decorationType, ranges);
        this.currentHover = { editor, line: currentLine };
      } else if (this.currentHover && this.currentHover.line === currentLine) {
        this.clearHighlight(editor);
        this.currentHover = null;
      }
    } catch (error) {
      console.error(error);
    }
  };

  private clearDocumentDiagnostics = (document: vscode.TextDocument) => {
    if (!isProcessableDocument(document)) {
      return;
    }

    const matchingEditors = vscode.window.visibleTextEditors.filter((editor: vscode.TextEditor) =>
      editor.document.uri.toString() === document.uri.toString()
    );
    for (const editor of matchingEditors) {
      this.clearHighlight(editor);
    }

    if (this.currentHover && this.currentHover.editor.document.uri.toString() === document.uri.toString()) {
      this.currentHover = null;
    }
  };

  private clearHighlight(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
  }
}
