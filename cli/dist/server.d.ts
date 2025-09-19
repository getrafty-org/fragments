#!/usr/bin/env node
export declare class FragmentsServer {
    private openFiles;
    private storage;
    constructor(storageFile: string);
    start(): Promise<void>;
    private handleMessage;
    private sendResponse;
    textDocumentDidOpen(params: {
        textDocument: {
            uri: string;
            text: string;
            version: number;
        };
    }): Promise<{
        success: boolean;
    }>;
    textDocumentDidChange(params: {
        textDocument: {
            uri: string;
            version: number;
        };
        contentChanges: Array<{
            text: string;
        }>;
    }): Promise<{
        success: boolean;
    }>;
    textDocumentDidClose(params: {
        textDocument: {
            uri: string;
        };
    }): Promise<{
        success: boolean;
    }>;
    applyFragments(params: {
        textDocument?: {
            uri: string;
        };
        filePath?: string;
    }): Promise<{
        success: boolean;
        newContent: string;
        appliedCount: number;
        hasChanges: boolean;
    }>;
    saveFragments(params: {
        textDocument?: {
            uri: string;
        };
        filePath?: string;
    }): Promise<{
        success: boolean;
        fragmentsSaved: number;
        activeVersion: string;
        issues: {
            type: string;
            fragmentId: string;
            parentFragmentId: string;
            startLine: number;
            endLine: number;
            message: string;
        }[];
    } | {
        success: boolean;
        activeVersion: string;
        fragmentsSaved: number;
        issues?: undefined;
    }>;
    switchVersion(params: {
        version: string;
    }): Promise<{
        success: boolean;
        version: string;
        updatedDocuments: ({
            uri: string;
            result: {
                success: boolean;
                newContent: string;
                appliedCount: number;
                hasChanges: boolean;
            };
            error?: undefined;
        } | {
            uri: string;
            error: string;
            result?: undefined;
        })[];
    }>;
    generateMarker(params: {
        languageId: string;
        lineContent?: string;
        indentation?: string;
    }): Promise<{
        success: boolean;
        fragmentId: string;
        markerText: string;
        insertPosition: "line-end" | "new-line";
    }>;
    getVersion(): Promise<{
        activeVersion: string;
        availableVersions: string[];
        initialized: boolean;
    }>;
    getFragmentPositions(params: {
        textDocument: {
            uri: string;
        };
        line: number;
    }): Promise<{
        success: boolean;
        markerLines: {
            line: number;
            isStartMarker: boolean;
            isEndMarker: boolean;
            fragmentId: string | null;
        }[];
    }>;
    getAllFragmentRanges(params: {
        textDocument: {
            uri: string;
        };
    }): Promise<{
        success: boolean;
        fragments: {
            id: string;
            startLine: number;
            endLine: number;
        }[];
    }>;
    init(params: {
        versions?: string[];
        activeVersion?: string;
    }): Promise<{
        success: boolean;
        message: string;
    }>;
}
//# sourceMappingURL=server.d.ts.map