export class RevisionTracker {
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<string, number>();

  nextRevision(uri: string): number {
    const next = (this.revisions.get(uri) ?? 0) + 1;
    this.revisions.set(uri, next);
    this.pending.set(uri, next);
    return next;
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
