import { ProjectFragments } from './types';
export declare class FragmentStorage {
    private static readonly STORAGE_FILE;
    private static readonly SCHEMA_VERSION;
    static isInitialized(dir?: string): boolean;
    static initialize(dir?: string, versions?: string[], activeVersion?: string): Promise<ProjectFragments>;
    static load(dir?: string): Promise<ProjectFragments | null>;
    static save(data: ProjectFragments, dir?: string): Promise<void>;
    static updateFragment(fragmentId: string, version: string, content: string, dir?: string): Promise<void>;
    static getFragmentContent(fragmentId: string, version: string, dir?: string): Promise<string | null>;
}
//# sourceMappingURL=storage.d.ts.map