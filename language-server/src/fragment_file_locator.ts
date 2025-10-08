import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { pathToFileURL } from 'url';
import { FragmentUtils } from './fragment_utils';

export interface DiscoveredFragmentFile {
  readonly path: string;
  readonly uri: string;
}

export interface FragmentFileLocator {
  listFragmentFiles(): Promise<DiscoveredFragmentFile[]>;
}

const DEFAULT_IGNORE_PATTERNS = ['.git/', 'node_modules/', 'dist/', 'out/', 'build/'];

export class WorkspaceFragmentLocator implements FragmentFileLocator {
  private readonly matcher: Ignore;

  constructor(
    private readonly workspaceRoot: string,
    private readonly fsModule: typeof fs = fs
  ) {
    this.matcher = ignore({ ignorecase: false });
    this.matcher.add(DEFAULT_IGNORE_PATTERNS);
    const userPatterns = this.loadIgnorePatterns(workspaceRoot);
    if (userPatterns.length > 0) {
      this.matcher.add(userPatterns);
    }
  }

  async listFragmentFiles(): Promise<DiscoveredFragmentFile[]> {
    const results = new Map<string, DiscoveredFragmentFile>();
    await this.walk(this.workspaceRoot, results);
    return Array.from(results.values());
  }

  private async walk(directory: string, results: Map<string, DiscoveredFragmentFile>): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await this.fsModule.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (this.shouldIgnore(fullPath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.walk(fullPath, results);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const containsFragments = await this.fileContainsFragments(fullPath);
      if (!containsFragments) {
        continue;
      }

      const uri = pathToFileURL(fullPath).toString();
      results.set(uri, { path: fullPath, uri });
    }
  }

  private async fileContainsFragments(filePath: string): Promise<boolean> {
    try {
      const content = await this.fsModule.promises.readFile(filePath, 'utf8');
      return FragmentUtils.containsFragmentMarkers(content);
    } catch {
      return false;
    }
  }

  private loadIgnorePatterns(root: string): string[] {
    const ignoreFile = path.join(root, '.fragmentsignore');
    if (!this.fsModule.existsSync(ignoreFile)) {
      return [];
    }

    return this.fsModule
      .readFileSync(ignoreFile, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }

  private shouldIgnore(targetPath: string, isDirectory: boolean): boolean {
    const relative = path.relative(this.workspaceRoot, targetPath) || '.';
    if (!relative || relative === '.') {
      return false;
    }

    const normalized = relative.split(path.sep).join('/');
    const candidate = isDirectory ? `${normalized}/` : normalized;
    return this.matcher.ignores(candidate);
  }
}
