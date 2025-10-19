export interface DocumentState {
  uri: string;
  content: string;
  version: number;
  hasUnsavedChanges: boolean;
}

export class DocumentManager {
  private readonly documents = new Map<string, DocumentState>();

  open(document: DocumentState): void {
    this.documents.set(document.uri, { ...document });
  }

  applyChange(uri: string, content: string, version: number): DocumentState {
    const existing = this.getRequired(uri);
    const updated: DocumentState = {
      ...existing,
      content,
      version,
      hasUnsavedChanges: true
    };
    this.documents.set(uri, updated);
    return updated;
  }

  close(uri: string): void {
    this.documents.delete(uri);
  }

  updateContent(uri: string, content: string): DocumentState {
    const existing = this.getRequired(uri);
    existing.content = content;
    existing.hasUnsavedChanges = true;
    existing.version += 1;
    this.documents.set(uri, { ...existing });
    return existing;
  }

  markSaved(uri: string): DocumentState {
    const existing = this.getRequired(uri);
    existing.hasUnsavedChanges = false;
    this.documents.set(uri, { ...existing });
    return existing;
  }

  markSavedIfPresent(uri: string): void {
    const existing = this.documents.get(uri);
    if (!existing) {
      return;
    }

    existing.hasUnsavedChanges = false;
    this.documents.set(uri, { ...existing });
  }

  get(uri: string): DocumentState | undefined {
    const doc = this.documents.get(uri);
    return doc ? { ...doc } : undefined;
  }

  getRequired(uri: string): DocumentState {
    const doc = this.documents.get(uri);
    if (!doc) {
      throw new Error(`Document not open: ${uri}`);
    }
    return { ...doc };
  }

  entries(): DocumentState[] {
    return Array.from(this.documents.values()).map(doc => ({ ...doc }));
  }
}
