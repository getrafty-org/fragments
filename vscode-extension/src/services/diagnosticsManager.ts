import * as vscode from 'vscode';
import { FragmentIssue } from 'fgmpack-protocol';

export class FragmentDiagnosticsManager implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('fgmpack');

  setIssues(document: vscode.TextDocument, issues: FragmentIssue[]): void {
    const diagnostics = issues.map(issue => {
      const startLine = Math.min(issue.startLine ?? 0, document.lineCount - 1);
      const endLine = Math.min(issue.endLine ?? startLine, document.lineCount - 1);
      const range = new vscode.Range(
        new vscode.Position(startLine, 0),
        new vscode.Position(endLine, document.lineAt(endLine).text.length)
      );

      return new vscode.Diagnostic(
        range,
        issue.message || 'Fragments issue detected.',
        vscode.DiagnosticSeverity.Error
      );
    });

    this.collection.set(document.uri, diagnostics);
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  dispose(): void {
    this.collection.dispose();
  }
}
