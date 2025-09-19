#!/usr/bin/env node
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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const storage_1 = require("./storage");
const fragmentUtils_1 = require("./fragmentUtils");
function parseOptions(params) {
    return {
        storageFile: params.storageFile,
        workingDirectory: params.workingDirectory || process.cwd()
    };
}
function createStorage(options) {
    const storageFile = options.storageFile || path.join(options.workingDirectory, '.fragments');
    return new storage_1.FragmentStorage(storageFile);
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: fragments <command> [params]');
        process.exit(1);
    }
    const command = args[0];
    const params = args[1] ? JSON.parse(args[1]) : {};
    const requestId = Math.random().toString(36).substring(7);
    const options = parseOptions(params);
    const storage = createStorage(options);
    try {
        let result;
        switch (command) {
            case 'get-version':
                const data = await storage.load();
                result = {
                    activeVersion: data.activeVersion,
                    availableVersions: data.availableVersions,
                    initialized: true
                };
                break;
            case 'set-version':
                const { version } = params;
                if (!version) {
                    throw new Error('version is required');
                }
                await storage.switchVersion(version);
                // Always update files when switching versions
                const updateResult = await storage.updateFilesWithVersion(options.workingDirectory, version);
                result = {
                    success: true,
                    activeVersion: version,
                    message: `Switched to version '${version}'`,
                    filesUpdated: updateResult.updatedFiles,
                    fragmentsProcessed: updateResult.fragmentsProcessed
                };
                break;
            case 'init':
                const { versions, activeVersion } = params;
                await storage.initialize(versions, activeVersion);
                result = { success: true, message: 'Fragments initialized successfully' };
                break;
            case 'generate-marker':
                const { languageId, lineContent, indentation } = params;
                if (!languageId) {
                    throw new Error('languageId is required');
                }
                const markerResult = fragmentUtils_1.FragmentUtils.generateMarkerInsertion({
                    languageId,
                    lineContent: lineContent || '',
                    indentation: indentation
                });
                result = {
                    fragmentId: markerResult.fragmentId,
                    markerText: markerResult.markerText,
                    insertPosition: markerResult.insertPosition,
                    success: true
                };
                break;
            case 'set-fragment':
                const { fragmentId, version: fragmentVersion, content } = params;
                if (!fragmentId || !fragmentVersion || content === undefined) {
                    throw new Error('fragmentId, version, and content are required');
                }
                await storage.updateFragment(fragmentId, fragmentVersion, content);
                result = {
                    success: true,
                    fragmentId,
                    version: fragmentVersion,
                    message: `Fragment '${fragmentId}' set for version '${fragmentVersion}'`
                };
                break;
            case 'save':
                const { filePath: saveFilePath } = params;
                if (!saveFilePath) {
                    throw new Error('filePath is required');
                }
                // Read file from disk
                if (!fs.existsSync(saveFilePath)) {
                    throw new Error(`File not found: ${saveFilePath}`);
                }
                const fileContent = fs.readFileSync(saveFilePath, 'utf-8');
                const currentData = await storage.load();
                const fragments = fragmentUtils_1.FragmentUtils.parseFragmentsWithLines(fileContent);
                // Auto-discover and ensure all fragments exist in storage
                for (const fragment of fragments) {
                    await storage.ensureFragment(fragment.id, fragment.currentContent);
                }
                let savedCount = 0;
                for (const fragment of fragments) {
                    await storage.updateFragment(fragment.id, currentData.activeVersion, fragment.currentContent);
                    savedCount++;
                }
                result = {
                    success: true,
                    filePath: saveFilePath,
                    activeVersion: currentData.activeVersion,
                    fragmentsSaved: savedCount,
                    message: `Saved ${savedCount} fragments from ${saveFilePath} to version '${currentData.activeVersion}'`
                };
                break;
            case 'apply':
                const { filePath: applyFilePath } = params;
                if (!applyFilePath) {
                    throw new Error('filePath is required');
                }
                // Read file from disk
                if (!fs.existsSync(applyFilePath)) {
                    throw new Error(`File not found: ${applyFilePath}`);
                }
                const originalContent = fs.readFileSync(applyFilePath, 'utf-8');
                const applyData = await storage.load();
                const applyFragments = fragmentUtils_1.FragmentUtils.parseFragmentsWithLines(originalContent);
                // Auto-discover and ensure all fragments exist in storage
                for (const fragment of applyFragments) {
                    await storage.ensureFragment(fragment.id, fragment.currentContent);
                }
                let updatedContent = originalContent;
                let appliedCount = 0;
                for (const fragment of applyFragments) {
                    const fragmentData = await storage.getFragmentContent(fragment.id, applyData.activeVersion);
                    if (fragmentData !== null && fragmentData !== fragment.currentContent) {
                        updatedContent = fragmentUtils_1.FragmentUtils.replaceFragmentContent(updatedContent, fragment.id, fragmentData);
                        appliedCount++;
                    }
                }
                // Write back to disk if there were changes
                if (appliedCount > 0) {
                    fs.writeFileSync(applyFilePath, updatedContent, 'utf-8');
                }
                result = {
                    success: true,
                    filePath: applyFilePath,
                    activeVersion: applyData.activeVersion,
                    fragmentsApplied: appliedCount,
                    hasChanges: appliedCount > 0,
                    message: `Applied ${appliedCount} fragments to ${applyFilePath} from version '${applyData.activeVersion}'`
                };
                break;
            default:
                throw new Error(`Unknown command: ${command}`);
        }
        const response = {
            id: requestId,
            result
        };
        console.log(JSON.stringify(response));
    }
    catch (error) {
        const response = {
            id: requestId,
            error: {
                code: 1,
                message: error instanceof Error ? error.message : String(error)
            }
        };
        console.log(JSON.stringify(response));
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map