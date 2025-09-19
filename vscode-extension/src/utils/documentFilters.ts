import * as vscode from 'vscode';

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt',
  '.dart', '.sql', '.html', '.css', '.scss', '.less', '.vue', '.svelte'
]);

export function isProcessableDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file' || document.isUntitled) {
    return false;
  }

  const lastDotIndex = document.fileName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return false;
  }

  const extension = document.fileName.toLowerCase().substring(lastDotIndex);
  return CODE_EXTENSIONS.has(extension);
}
