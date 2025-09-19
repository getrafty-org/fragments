export interface FragmentMarker {
    start: string;
    end: string;
    id: string;
}
export interface FragmentContent {
    id: string;
    versions: Record<string, string>;
    metadata?: {
        created?: Date;
        modified?: Date;
        description?: string;
    };
}
export interface VersionConfig {
    name: string;
    encrypted: boolean;
    keyId?: string;
}
export interface ProjectFragments {
    schema: string;
    activeVersion: string;
    availableVersions: string[];
    versionConfig: Record<string, VersionConfig>;
    fragments: Record<string, FragmentContent>;
    metadata: {
        created: Date;
        modified: Date;
        version: string;
    };
}
export interface FragmentMatch {
    fullMatch: string;
    id: string;
    currentContent: string;
    startIndex: number;
    endIndex: number;
    startLine: number;
    endLine: number;
}
export interface CLIRequest {
    id: string;
    method: string;
    params: any;
}
export interface CLIResponse {
    id: string;
    result?: any;
    error?: {
        code: number;
        message: string;
    };
}
export interface CLICommands {
    'init': {
        versions?: string[];
        activeVersion?: string;
    };
    'list': {};
    'set-version': {
        version: string;
        key?: string;
        keyFile?: string;
    };
    'get-version': {};
    'create-version': {
        name: string;
        encrypted?: boolean;
        key?: string;
        keyFile?: string;
    };
    'generate-marker': {
        languageId: string;
        lineContent?: string;
        indentation?: string;
    };
    'apply': {
        files?: string[];
    };
    'extract': {
        version: string;
        files?: string[];
    };
}
//# sourceMappingURL=types.d.ts.map