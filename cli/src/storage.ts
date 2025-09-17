import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { ProjectFragments, FragmentContent } from './types';

export class FragmentStorage {
  private static readonly STORAGE_FILE = '.fragments';
  private static readonly SCHEMA_VERSION = '1.0.0';

  static isInitialized(dir: string = process.cwd()): boolean {
    return fs.existsSync(path.join(dir, this.STORAGE_FILE));
  }

  static async initialize(
    dir: string = process.cwd(),
    versions: string[] = ['public', 'private'],
    activeVersion: string = 'public'
  ): Promise<ProjectFragments> {
    const data: ProjectFragments = {
      activeVersion,
      availableVersions: versions,
      fragments: {},
      metadata: {
        created: new Date(),
        modified: new Date(),
        version: this.SCHEMA_VERSION
      }
    };

    await this.save(data, dir);
    return data;
  }

  static async load(dir: string = process.cwd()): Promise<ProjectFragments | null> {
    const filePath = path.join(dir, this.STORAGE_FILE);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const compressed = fs.readFileSync(filePath);
    const decompressed = zlib.gunzipSync(compressed);
    const data = JSON.parse(decompressed.toString()) as ProjectFragments;

    if (data.metadata.created) {
      data.metadata.created = new Date(data.metadata.created);
    }
    if (data.metadata.modified) {
      data.metadata.modified = new Date(data.metadata.modified);
    }

    return data;
  }

  static async save(data: ProjectFragments, dir: string = process.cwd()): Promise<void> {
    const filePath = path.join(dir, this.STORAGE_FILE);

    data.metadata.modified = new Date();

    const json = JSON.stringify(data, null, 2);
    const compressed = zlib.gzipSync(json);

    fs.writeFileSync(filePath, compressed);
  }

  static async updateFragment(
    fragmentId: string,
    version: string,
    content: string,
    dir: string = process.cwd()
  ): Promise<void> {
    const data = await this.load(dir);
    if (!data) {
      throw new Error('Fragments not initialized. Run "fragments init" first.');
    }

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

    await this.save(data, dir);
  }

  static async getFragmentContent(
    fragmentId: string,
    version: string,
    dir: string = process.cwd()
  ): Promise<string | null> {
    const data = await this.load(dir);
    if (!data) {
      return null;
    }

    const fragment = data.fragments[fragmentId];
    if (!fragment) {
      return null;
    }

    return fragment.versions[version] || null;
  }
}