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
exports.FragmentsCLI = void 0;
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
class FragmentsCLI {
    static getCliPath() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }
        return 'node';
    }
    static getCliArgs() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }
        return [vscode.Uri.joinPath(workspaceFolder.uri, 'cli', 'dist', 'index.js').fsPath];
    }
    static getStorageFilePath() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }
        return vscode.Uri.joinPath(workspaceFolder.uri, '.fragments').fsPath;
    }
    static async executeCommand(method, params = {}) {
        return new Promise((resolve, reject) => {
            const request = {
                id: Math.random().toString(36).substring(7),
                method,
                params
            };
            // Add storage file path to params
            const enhancedParams = {
                ...params,
                storageFile: this.getStorageFilePath(),
                workingDirectory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            };
            const cliPath = this.getCliPath();
            const cliArgs = [...this.getCliArgs(), method, JSON.stringify(enhancedParams)];
            const child = (0, child_process_1.spawn)(cliPath, cliArgs, {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const response = JSON.parse(stdout.trim());
                        if (response.error) {
                            reject(new Error(response.error.message));
                        }
                        else {
                            resolve(response.result);
                        }
                    }
                    catch (error) {
                        reject(new Error(`Invalid JSON response: ${stdout}`));
                    }
                }
                else {
                    reject(new Error(`CLI process exited with code ${code}: ${stderr}`));
                }
            });
            child.on('error', (error) => {
                reject(error);
            });
        });
    }
}
exports.FragmentsCLI = FragmentsCLI;
//# sourceMappingURL=cli.js.map