import * as fs from 'fs';
import * as zlib from 'zlib';
import { ProjectFragments, FragmentContent } from './types';

export interface IFragmentStorage {
  isInitialized(): boolean;
  initialize(versions?: string[], activeVersion?: string): Promise<ProjectFragments>;
  load(): Promise<ProjectFragments>;
  save(data: ProjectFragments): Promise<void>;
  ensureFragment(fragmentId: string, currentContent?: string): Promise<void>;
  updateFragment(fragmentId: string, version: string, content: string): Promise<void>;
  getFragmentContent(fragmentId: string, version: string): Promise<string | null>;
  switchVersion(versionName: string): Promise<void>;
}

export class FragmentStorage implements IFragmentStorage {
  private readonly SCHEMA_VERSION = '2.0.0';
  private readonly storageFilePath: string;

  constructor(storageFilePath: string) {
    this.storageFilePath = storageFilePath;
  }

  isInitialized(): boolean {
    return fs.existsSync(this.storageFilePath);
  }

  async initialize(
    versions: string[] = ['public', 'private'],
    activeVersion: string = 'public'
  ): Promise<ProjectFragments> {
    const data: ProjectFragments = {
      schema: this.SCHEMA_VERSION,
      activeVersion,
      availableVersions: versions,
      fragments: {},
      metadata: {
        created: new Date(),
        modified: new Date(),
        version: this.SCHEMA_VERSION
      }
    };

    await this.save(data);
    return data;
  }

  async load(): Promise<ProjectFragments> {
    if (!fs.existsSync(this.storageFilePath)) {
      // Auto-create storage with defaults
      console.error('[Storage] No storage file found, creating new one');
      return await this.initialize();
    }

    try {
      const compressed = fs.readFileSync(this.storageFilePath);
      const decompressed = zlib.gunzipSync(compressed);
      const data = JSON.parse(decompressed.toString()) as ProjectFragments;

      // Convert metadata dates
      if (data.metadata.created) {
        data.metadata.created = new Date(data.metadata.created);
      }
      if (data.metadata.modified) {
        data.metadata.modified = new Date(data.metadata.modified);
      }

      // Convert fragment metadata dates
      Object.values(data.fragments).forEach(fragment => {
        if (fragment.metadata?.created) {
          fragment.metadata.created = new Date(fragment.metadata.created);
        }
        if (fragment.metadata?.modified) {
          fragment.metadata.modified = new Date(fragment.metadata.modified);
        }
      });

      return data;
    } catch (error) {
      console.error('[Storage] Error reading storage file, creating new one:', error);
      return await this.initialize();
    }
  }

  async save(data: ProjectFragments): Promise<void> {
    data.metadata.modified = new Date();

    const json = JSON.stringify(data, null, 2);
    const compressed = zlib.gzipSync(json);

    fs.writeFileSync(this.storageFilePath, compressed);
  }

  async ensureFragment(fragmentId: string, currentContent: string = ''): Promise<void> {
    const data = await this.load();

    if (!data.fragments[fragmentId]) {
      console.error(`[Storage] Auto-creating fragment: ${fragmentId} with content for ${data.activeVersion}`);

      // Create fragment with current content for active version, empty for others
      const versions: Record<string, string> = {};
      for (const version of data.availableVersions) {
        versions[version] = version === data.activeVersion ? currentContent : '';
      }

      data.fragments[fragmentId] = {
        id: fragmentId,
        versions,
        metadata: {
          created: new Date(),
          modified: new Date()
        }
      };

      await this.save(data);
    }
  }

  async updateFragment(
    fragmentId: string,
    version: string,
    content: string
  ): Promise<void> {
    const data = await this.load();

    if (!data.fragments[fragmentId]) {
      data.fragments[fragmentId] = {
        id: fragmentId,
        versions: {},
        metadata: {
          created: new Date(),
          modified: new Date()
        }
      };
    }

    data.fragments[fragmentId].versions[version] = content;
    data.fragments[fragmentId].metadata!.modified = new Date();

    await this.save(data);
  }

  async getFragmentContent(
    fragmentId: string,
    version: string
  ): Promise<string | null> {
    const data = await this.load();
    const fragment = data.fragments[fragmentId];
    if (!fragment) {
      return null;
    }

    return fragment.versions[version] || null;
  }

  async switchVersion(versionName: string): Promise<void> {
    const data = await this.load();

    if (!data.availableVersions.includes(versionName)) {
      throw new Error(`Version '${versionName}' does not exist. Available versions: ${data.availableVersions.join(', ')}`);
    }

    data.activeVersion = versionName;
    await this.save(data);
  }
}
