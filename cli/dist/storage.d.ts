import { ProjectFragments } from './types';
export interface IFragmentStorage {
    isInitialized(): boolean;
    initialize(versions?: string[], activeVersion?: string): Promise<ProjectFragments>;
    load(): Promise<ProjectFragments>;
    save(data: ProjectFragments): Promise<void>;
    ensureFragment(fragmentId: string, currentContent?: string): Promise<void>;
    updateFragment(fragmentId: string, version: string, content: string): Promise<void>;
    getFragmentContent(fragmentId: string, version: string): Promise<string | null>;
    createVersion(name: string, encrypted?: boolean, key?: string): Promise<void>;
    listVersions(): Promise<{
        active: string;
        versions: Array<{
            name: string;
            encrypted: boolean;
            keyId?: string;
        }>;
    } | null>;
    switchVersion(versionName: string): Promise<void>;
    updateFilesWithVersion(workingDirectory: string, versionName: string): Promise<{
        updatedFiles: string[];
        fragmentsProcessed: number;
    }>;
}
export interface IEncryptionService {
    encrypt(content: string, key: string): string;
    decrypt(encryptedContent: string, key: string): string;
}
export declare class EncryptionService implements IEncryptionService {
    private generateKeyHash;
    encrypt(content: string, key: string): string;
    decrypt(encryptedContent: string, key: string): string;
}
export declare class FragmentStorage implements IFragmentStorage {
    private readonly SCHEMA_VERSION;
    private readonly storageFilePath;
    private readonly encryptionService;
    constructor(storageFilePath: string, encryptionService?: IEncryptionService);
    isInitialized(): boolean;
    initialize(versions?: string[], activeVersion?: string): Promise<ProjectFragments>;
    load(): Promise<ProjectFragments>;
    save(data: ProjectFragments): Promise<void>;
    ensureFragment(fragmentId: string, currentContent?: string): Promise<void>;
    updateFragment(fragmentId: string, version: string, content: string): Promise<void>;
    getFragmentContent(fragmentId: string, version: string): Promise<string | null>;
    createVersion(name: string, encrypted?: boolean, key?: string): Promise<void>;
    listVersions(): Promise<{
        active: string;
        versions: Array<{
            name: string;
            encrypted: boolean;
            keyId?: string;
        }>;
    } | null>;
    switchVersion(versionName: string): Promise<void>;
    updateFilesWithVersion(workingDirectory: string, versionName: string): Promise<{
        updatedFiles: string[];
        fragmentsProcessed: number;
    }>;
    private updateFileFragments;
}
//# sourceMappingURL=storage.d.ts.map