import { FragmentFileLocator } from '../../fragmentFileLocator';

export interface MockFragmentFile {
  path: string;
  uri: string;
}

export class MockFragmentFileLocator implements FragmentFileLocator {
  private files: MockFragmentFile[] = [];

  async listFragmentFiles(): Promise<MockFragmentFile[]> {
    return [...this.files];
  }

  // Test helpers
  addFile(path: string, uri: string): void {
    this.files.push({ path, uri });
  }

  clearFiles(): void {
    this.files = [];
  }

  setFiles(files: MockFragmentFile[]): void {
    this.files = [...files];
  }
}