import type { Bridge, ComposerDraft } from '../shared/types.js';

function checkedDraft(value: unknown, projectId: string | null): ComposerDraft {
  if (!value || typeof value !== 'object') throw new Error('Geçersiz taslak kaydı.');
  const row = value as ComposerDraft;
  if (row.projectId !== projectId || !(row.conversationId === null || typeof row.conversationId === 'string') ||
      typeof row.text !== 'string' || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      !(row.updatedAt === null || typeof row.updatedAt === 'string')) {
    throw new Error('Taslak kaydının alanı veya biçimi doğrulanamadı.');
  }
  return { projectId, conversationId: row.conversationId, text: row.text, revision: row.revision, updatedAt: row.updatedAt };
}

export interface DraftView { text(value: string): void; locked(value: boolean): void; state(message: string, failed: boolean): void }
// In-memory editing only; the caller supplies and secures its storage adapter.
// One coalesced write, no idle polling, no browser prompt storage or AI calls.
export class DraftEditor {
  private record?: ComposerDraft;
  private text = '';
  private conversationId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private writing?: Promise<void>;
  private failure?: Error;
  private transition = 0;
  private switching = false;
  private closing = false;
  constructor(private api: Pick<Bridge, 'draft' | 'saveDraft'>, private view: DraftView, private debounceMs = 600) {}
  get dirty(): boolean { return Boolean(this.record && (this.text !== this.record.text || this.conversationId !== this.record.conversationId)); }
  get unsettled(): boolean { return this.dirty || Boolean(this.writing); }
  private stopTimer(): void { clearTimeout(this.timer); this.timer = undefined; }
  stop(): void { this.stopTimer(); }
  async prepareClose(): Promise<void> {
    this.closing = true; this.stopTimer(); this.view.locked(true);
    if (this.switching) throw new Error('Taslak alanı hâlâ değişiyor. Kapanışı tekrar dene.');
    await this.flush();
    if (this.unsettled) throw new Error('Son taslağın kaydı henüz doğrulanamadı.');
  }
  private schedule(): void {
    this.stopTimer();
    if (!this.dirty) return;
    this.view.state('Taslak kaydediliyor…', false);
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}); }, this.debounceMs);
  }
  edit(text: string, conversationId: string | null): void {
    if (!this.record || this.switching || this.closing) return;
    this.text = text; this.conversationId = conversationId;
    if (!this.failure) this.schedule();
  }
  target(conversationId: string | null): void { this.edit(this.text, conversationId); }
  async open(projectId: string | null): Promise<void> {
    if (this.closing) throw new Error('Uygulama kapanıyor; taslak alanı değiştirilemez.');
    if (this.record?.projectId === projectId && !this.switching) { await this.flush(); return; }
    const epoch = ++this.transition;
    this.switching = true; this.view.locked(true); this.view.text('');
    try {
      await this.flush();
      const next = await this.api.draft(projectId);
      if (epoch !== this.transition) return;
      const record = checkedDraft(next, projectId);
      this.record = record; this.text = record.text; this.conversationId = record.conversationId;
      this.failure = undefined; this.switching = false; this.view.text(this.text); this.view.locked(this.closing);
      this.view.state(next.text ? 'Kaydedilen taslak geri getirildi.' : 'Taslak bu uygulamanın seçtiği depoya kaydedilir.', false);
    } catch (error) {
      if (epoch === this.transition) {
        this.view.state(error instanceof Error ? error.message : 'Taslak açılamadı; mevcut metin korundu.', true);
        // Do not expose the previous workspace's private text in the new scope.
        if (this.record?.projectId === projectId) this.view.text(this.text);
      }
      throw error;
    }
  }
  flush(): Promise<void> {
    this.stopTimer();
    if (this.writing) return this.writing;
    if (this.failure) return Promise.reject(this.failure);
    const task = Promise.resolve().then(async () => {
      while (this.record && this.dirty) {
        const input = { projectId: this.record.projectId, conversationId: this.conversationId, text: this.text, expectedRevision: this.record.revision };
        this.view.state('Taslak kaydediliyor…', false);
        if (!Number.isSafeInteger(input.expectedRevision + 1)) throw new Error('Taslak revizyon sınırına ulaşıldı.');
        const saved = checkedDraft(await this.api.saveDraft(input), input.projectId);
        if (saved.text !== input.text || saved.conversationId !== input.conversationId || saved.revision !== input.expectedRevision + 1) {
          throw new Error('Taslak kayıt onayı gönderilen değişiklikle eşleşmiyor.');
        }
        this.record = saved;
        // A newer keystroke while this save was pending stays in the editor and
        // is the only next write. An old ACK never replaces the owner's text.
      }
      this.view.state(this.text ? 'Taslak depolama katmanı tarafından onaylandı.' : 'Mesaj taslağı boş.', false);
    }).catch(error => {
      this.failure = error instanceof Error ? error : new Error('Taslak kaydedilemedi; bu metin pencerede korunuyor.');
      this.view.state(this.failure.message, true); throw this.failure;
    }).finally(() => { if (this.writing === task) this.writing = undefined; });
    this.writing = task; return task;
  }
  retry(): Promise<void> { this.failure = undefined; return this.flush(); }
  async clearSent(text: string): Promise<void> {
    if (this.closing) return;
    if (this.text !== text) return; // Never erase a newer draft typed during work.
    this.text = ''; this.view.text('');
    try { await this.flush(); }
    catch (error) { if (!this.text) { this.text = text; this.view.text(text); } throw error; }
  }
  // Called only after an explicit owner discard confirmation. Read failure
  // preserves local text; no automated conflict overwrite or retry is allowed.
  async reload(projectId: string | null): Promise<void> {
    if (this.closing) throw new Error('Uygulama kapanıyor; taslağı kaydetmeyi yeniden dene.');
    const epoch = ++this.transition;
    this.stopTimer(); this.switching = true; this.view.locked(true);
    try {
      await this.writing?.catch(() => {});
      const next = await this.api.draft(projectId);
      if (epoch !== this.transition) return;
      const record = checkedDraft(next, projectId);
      this.record = record; this.text = record.text; this.conversationId = record.conversationId;
      this.failure = undefined; this.switching = false; this.view.text(next.text); this.view.locked(this.closing);
      this.view.state(next.text ? 'Kayıtlı taslak açıldı.' : 'Kayıtlı mesaj taslağı boş.', false);
    } catch (error) {
      if (epoch === this.transition) {
        this.switching = false; this.view.locked(this.closing || this.record?.projectId !== projectId);
        this.view.state('Kayıtlı taslak açılamadı; bu penceredeki metin korundu.', true);
      }
      throw error;
    }
  }
}
