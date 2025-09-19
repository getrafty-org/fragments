import * as vscode from 'vscode';
export declare class EditorUtils {
    /**
     * Get the indentation of the current line
     */
    static getLineIndentation(document: vscode.TextDocument, line: number): string;
    /**
     * Insert fragment marker at the current cursor position using CLI
     */
    static insertFragmentAtCursor(editor: vscode.TextEditor): Promise<string | null>;
}
