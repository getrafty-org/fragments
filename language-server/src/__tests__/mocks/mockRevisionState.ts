import { RevisionState } from '../../revisionState';

export class MockRevisionState implements RevisionState {
  private revisions = new Map<string, number>();

  next(uri: string): number {
    const current = this.revisions.get(uri) ?? 0;
    const next = current + 1;
    this.revisions.set(uri, next);
    return next;
  }

  acknowledge(uri: string, revision: number): boolean {
    const current = this.revisions.get(uri);
    return current === revision;
  }

  prune(keepUris: Set<string>): string[] {
    const removed: string[] = [];
    for (const [uri] of this.revisions) {
      if (!keepUris.has(uri)) {
        this.revisions.delete(uri);
        removed.push(uri);
      }
    }
    return removed;
  }

  // Test helpers
  reset(): void {
    this.revisions.clear();
  }

  setRevision(uri: string, revision: number): void {
    this.revisions.set(uri, revision);
  }

  getRevision(uri: string): number | undefined {
    return this.revisions.get(uri);
  }
}