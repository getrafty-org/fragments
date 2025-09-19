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
exports.EditorUtils = void 0;
const vscode = __importStar(require("vscode"));
const cli_1 = require("./cli");
class EditorUtils {
    /**
     * Get the indentation of the current line
     */
    static getLineIndentation(document, line) {
        const lineText = document.lineAt(line).text;
        const match = lineText.match(/^(\s*)/);
        return match ? match[1] : '';
    }
    /**
     * Insert fragment marker at the current cursor position using CLI
     */
    static async insertFragmentAtCursor(editor) {
        const document = editor.document;
        const selection = editor.selection;
        const position = selection.active;
        // Get current line content and indentation
        const lineContent = document.lineAt(position.line).text;
        const indentation = this.getLineIndentation(document, position.line);
        try {
            // Use CLI to generate the fragment marker
            const result = await cli_1.FragmentsCLI.executeCommand('generate-marker', {
                languageId: document.languageId,
                lineContent: lineContent,
                indentation: indentation
            });
            if (!result.success) {
                throw new Error('Failed to generate marker');
            }
            // Determine insertion position (end of current line)
            const lineEndPosition = new vscode.Position(position.line, document.lineAt(position.line).text.length);
            // Insert the fragment marker
            await editor.edit(editBuilder => {
                editBuilder.insert(lineEndPosition, '\n' + result.markerText + '\n');
            });
            // Position cursor between the markers (after first marker line + empty line)
            const newPosition = new vscode.Position(position.line + 2, indentation.length);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            return result.fragmentId;
        }
        catch (error) {
            throw new Error(`Failed to insert fragment marker: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
exports.EditorUtils = EditorUtils;
//# sourceMappingURL=fragmentUtils.js.map