export interface RevisionState {
  next(uri: string): number;
  acknowledge(uri: string, revision: number): boolean;
  prune(activeUris: Set<string>): string[];
}

export class MemoryRevisionState implements RevisionState {
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<string, number>();

  next(uri: string): number {
    const nextRevision = (this.revisions.get(uri) ?? 0) + 1;
    this.revisions.set(uri, nextRevision);
    this.pending.set(uri, nextRevision);
    return nextRevision;
  }

  acknowledge(uri: string, revision: number): boolean {
    const expected = this.pending.get(uri);
    if (expected === undefined || expected !== revision) {
      return false;
    }

    this.pending.delete(uri);
    this.revisions.set(uri, revision);
    return true;
  }

  prune(activeUris: Set<string>): string[] {
    const removed: string[] = [];
    for (const uri of Array.from(this.revisions.keys())) {
      if (activeUris.has(uri)) {
        continue;
      }

      removed.push(uri);
      this.revisions.delete(uri);
      this.pending.delete(uri);
    }

    return removed;
  }
}
