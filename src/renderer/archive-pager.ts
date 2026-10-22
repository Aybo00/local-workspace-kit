import type { ArchivePage, ArchivePageInput } from '../shared/types.js';

// Keep just one bounded page in the UI. An old asynchronous page cannot replace
// a newly selected scope/refresh, and repeated clicks do not duplicate requests.
export class ArchivePager<T> {
  private generation = 0;
  private projectId: string | null = null;
  private beforeId: string | undefined;
  private loading = false;
  private value: ArchivePage<T> = { items: [], nextCursor: null };
  constructor(private fetchPage: (input: ArchivePageInput) => Promise<ArchivePage<T>>, private changed: () => void) {}
  get items(): T[] { return this.value.items; }
  get nextCursor(): string | null { return this.value.nextCursor; }
  get isLoading(): boolean { return this.loading; }
  get isOlderPage(): boolean { return this.beforeId !== undefined; }
  get scope(): string | null { return this.projectId; }
  replace(projectId: string | null, page: ArchivePage<T> = { items: [], nextCursor: null }): void {
    this.generation++; this.projectId = projectId; this.beforeId = undefined;
    this.loading = false; this.value = page; this.changed();
  }
  newest(): Promise<void> { return this.load(undefined); }
  // A confirmed write supersedes any older in-flight read. Retain the visible
  // page on failure; an obsolete page/error must not overwrite this refresh.
  refreshNewest(): Promise<void> { this.generation++; this.loading = false; return this.load(undefined); }
  older(): Promise<void> { return this.value.nextCursor ? this.load(this.value.nextCursor) : Promise.resolve(); }
  private async load(beforeId: string | undefined): Promise<void> {
    if (this.loading) return;
    const generation = ++this.generation, projectId = this.projectId;
    this.loading = true; this.changed();
    try {
      const page = await this.fetchPage({ projectId, ...(beforeId ? { beforeId } : {}) });
      if (generation !== this.generation || projectId !== this.projectId) return;
      this.value = page; this.beforeId = beforeId;
    } catch (error) {
      if (generation === this.generation && projectId === this.projectId) throw error;
    } finally {
      if (generation === this.generation) { this.loading = false; this.changed(); }
    }
  }
}
