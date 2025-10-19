import { Storage } from 'fgmpack-db';
import { FragmentID } from 'fgmpack-protocol';

export class MockStorage implements Storage {
  private _isOpen = false;
  private fragments = new Map<string, Map<string, string>>();
  private versions = ['public', 'private'];
  private activeVersion = 'public';

  isOpen(): boolean {
    return this._isOpen;
  }

  async open(versions?: string[], activeVersion?: string): Promise<void> {
    this._isOpen = true;
    if (versions) {
      this.versions = [...versions];
    }
    if (activeVersion && this.versions.includes(activeVersion)) {
      this.activeVersion = activeVersion;
    }
  }

  async close(): Promise<void> {
    this._isOpen = false;
  }

  async upsertFragment(id: FragmentID, currentContent: string = '', version: string | null = null): Promise<void> {
    const versionToUse = version ?? this.activeVersion;

    if (!this.versions.includes(versionToUse)) {
      throw new Error(`Version '${versionToUse}' does not exist.`);
    }

    const fragmentExists = this.fragments.has(id);

    // If version is specified and fragment doesn't exist, throw error (update mode)
    if (version !== null && !fragmentExists) {
      throw new Error(`Fragment '${id}' does not exist`);
    }

    if (!fragmentExists) {
      const versionMap = new Map<string, string>();
      this.versions.forEach(v => versionMap.set(v, ''));
      this.fragments.set(id, versionMap);
    }

    const fragmentVersions = this.fragments.get(id)!;

    // If version is null and fragment exists, do nothing (preserve existing content)
    if (version === null && fragmentExists) {
      return;
    }

    // If version is null (creating new fragment), only set active version content
    if (version === null) {
      fragmentVersions.set(this.activeVersion, currentContent);
    } else {
      fragmentVersions.set(versionToUse, currentContent);
    }
  }

  async getFragmentContent(id: FragmentID, version: string): Promise<string | null> {
    if (!this.versions.includes(version)) {
      throw new Error(`Version '${version}' does not exist.`);
    }

    const fragmentVersions = this.fragments.get(id);
    if (!fragmentVersions) {
      return null;
    }

    return fragmentVersions.get(version) ?? '';
  }

  async getAvailableVersions(): Promise<string[]> {
    return [...this.versions];
  }

  async getActiveVersion(): Promise<string> {
    return this.activeVersion;
  }

  async setActiveVersion(versionName: string): Promise<void> {
    if (!this.versions.includes(versionName)) {
      throw new Error(`Version '${versionName}' does not exist.`);
    }
    this.activeVersion = versionName;
  }

  // Test helpers
  reset(): void {
    this.fragments.clear();
    this.versions = ['public', 'private'];
    this.activeVersion = 'public';
    this._isOpen = false;
  }

  hasFragment(id: FragmentID): boolean {
    return this.fragments.has(id);
  }
}
