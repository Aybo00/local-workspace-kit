import type { ChatResult, Source } from './types.js';
import { CHAT_TEXT_LIMITS, ChatTextCursor, type ChatTextEvent, validChatTextEvent } from './chat-stream.js';

// Presentation protocol only. A dedicated authenticated POST must own this
// scope; these identifiers are correlation, never authentication or authority.
export interface OwnerChatScope { requestId: string; conversationId: string }
// Only fixed classifications cross the owner connection. Provider exceptions,
// keys, stack traces and response bodies must never become display text.
const failureMessages = Object.freeze({
  cancelled: 'Görev durduruldu. Yanıt tamamlanmadı.',
  interrupted: 'Uygulama kapanırken görev kesildi. Yanıt tamamlanmadı.',
  unavailable: 'Yanıt tamamlanamadı. Görev otomatik tekrar gönderilmedi.',
  'model-timeout': 'Model süre sınırında yanıtı tamamlayamadı. Görev otomatik tekrar gönderilmedi; daha kısa bir istek deneyebilirsin.',
  quota: 'Ücretsiz modelin kotası isteği karşılamadı. Ücretli modele geçilmedi; görev otomatik tekrar gönderilmedi.',
  'provider-unavailable': 'Model servisine erişilemedi. Görev otomatik tekrar gönderilmedi; bağlantıyı ve model servisini kontrol edebilirsin.',
  'invalid-response': 'Modelin yanıtı doğrulanamadı. Yarım metin tamamlanmış cevap olarak kaydedilmedi; görev otomatik tekrar gönderilmedi.',
  'resource-unavailable': 'Model belleğinin boşaldığı doğrulanamadı. Güvenlik için yeni ağır işler bekliyor; model belleği kontrolünü yeniden dene.',
  busy: 'Yanıt tamamlanamadı: başka bir görev hâlâ çalışıyor. Mevcut görev bitince veya durdurulunca yeniden deneyebilirsin.',
  'network-denied': 'Web isteğine izin verilmedi. Yanıt tamamlanamadı; bu isteğin verisi web aracına gönderilmedi.'
});
export type OwnerChatFailureReason = keyof typeof failureMessages;
const validFailure = (reason: unknown): reason is OwnerChatFailureReason => typeof reason === 'string' && Object.hasOwn(failureMessages, reason);
export class OwnerChatFailure extends Error {
  constructor(readonly reason: OwnerChatFailureReason) {
    super(validFailure(reason) ? failureMessages[reason] : failureMessages.unavailable);
    this.name = 'OwnerChatFailure';
  }
}
export type OwnerChatFrame = ({ type: 'start'; version: 1 } & OwnerChatScope) | ChatTextEvent
  | { type: 'result'; value: ChatResult }
  | { type: 'failed'; reason: OwnerChatFailureReason };
export const OWNER_CHAT_LIMITS = Object.freeze({ frameBytes: 2 * 1024 * 1024, bytes: 8 * 1024 * 1024,
  frames: CHAT_TEXT_LIMITS.events + 2, chunks: 131072, emptyChunks: 16, resultText: 150000 });
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const invalid = () => new Error('Yanıt bağlantısı doğrulanamadı. Görev otomatik tekrar gönderilmedi.');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string) => {
  const actual = Object.keys(value);
  return actual.length === expected.split(',').length && actual.sort().join(',') === expected;
};
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const label = (value: unknown): value is string => validChatTextEvent({ type: 'reset', generation: 1, modelLabel: value });

function validSource(value: unknown): value is Source {
  if (!record(value) || !keys(value, 'id,readAt,text,title,truncated,url') || typeof value.id !== 'string' || !uuid.test(value.id)
    || !bounded(value.title, 2000) || !bounded(value.text, 40000) || !bounded(value.url, 2048)
    || typeof value.truncated !== 'boolean' || typeof value.readAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.readAt) || !Number.isFinite(Date.parse(value.readAt))) return false;
  try { const url = new URL(value.url); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
function validResult(value: unknown): value is ChatResult {
  // Buffered research may append a source footer to the provider's 100k text.
  return record(value) && keys(value, 'content,modelLabel,notices,sources') && bounded(value.content, OWNER_CHAT_LIMITS.resultText)
    && Boolean(value.content.trim()) && label(value.modelLabel) && Array.isArray(value.sources) && value.sources.length <= 6
    && Array.from(value.sources).every(validSource) && Array.isArray(value.notices) && value.notices.length <= 32
    && Array.from(value.notices).every(notice => bounded(notice, 2000));
}
export function validOwnerChatFrame(value: unknown): value is OwnerChatFrame {
  if (!record(value)) return false;
  if (value.type === 'start') return keys(value, 'conversationId,requestId,type,version') && value.version === 1
    && typeof value.requestId === 'string' && uuid.test(value.requestId) && typeof value.conversationId === 'string' && uuid.test(value.conversationId);
  if (value.type === 'result') return keys(value, 'type,value') && validResult(value.value);
  if (value.type === 'failed') return keys(value, 'reason,type') && validFailure(value.reason);
  return validChatTextEvent(value);
}
export function encodeOwnerChatFrame(value: OwnerChatFrame): string {
  try {
    if (!validOwnerChatFrame(value)) throw invalid();
    const line = JSON.stringify(value) + '\n';
    if (new TextEncoder().encode(line).byteLength > OWNER_CHAT_LIMITS.frameBytes) throw invalid();
    return line;
  } catch { throw invalid(); }
}
const copyResult = (value: ChatResult): ChatResult => ({ content: value.content, modelLabel: value.modelLabel,
  sources: value.sources.map(source => ({ ...source })), notices: [...value.notices] });

// Shared sender/receiver ordering. A result is provisional until the caller
// verifies clean EOF. This class cannot prove SQL durability or model unload.
export class OwnerChatFrameCursor {
  private readonly expected: OwnerChatScope;
  private readonly text = new ChatTextCursor();
  private started = false; private terminal = false; private closed = false; private poisoned = false; private count = 0;
  private result?: ChatResult;
  private failure?: OwnerChatFailureReason;
  constructor(expected: OwnerChatScope) {
    if (!validOwnerChatFrame({ type: 'start', version: 1, ...expected })) throw invalid();
    this.expected = { ...expected };
  }
  accept(raw: unknown): Readonly<ChatTextEvent> | null {
    try {
      if (this.poisoned || this.closed || this.terminal || ++this.count > OWNER_CHAT_LIMITS.frames || !validOwnerChatFrame(raw)) throw invalid();
      if (!this.started) {
        if (raw.type !== 'start' || raw.requestId !== this.expected.requestId || raw.conversationId !== this.expected.conversationId) throw invalid();
        this.started = true; return null;
      }
      if (raw.type === 'start') throw invalid();
      if (raw.type === 'result') {
        if (this.text.modelLabel && (raw.value.modelLabel !== this.text.modelLabel || (this.text.text && raw.value.content !== this.text.text))) throw invalid();
        this.result = copyResult(raw.value); this.terminal = true; return null;
      }
      if (raw.type === 'failed') { this.failure = raw.reason; this.terminal = true; return null; }
      const accepted = this.text.accept(raw);
      return accepted ? Object.freeze({ ...accepted }) : null;
    } catch { this.poisoned = true; throw invalid(); }
  }
  finish(): ChatResult {
    if (this.poisoned || this.closed || !this.started || !this.terminal) { this.poisoned = true; throw invalid(); }
    this.closed = true;
    if (this.failure) throw new OwnerChatFailure(this.failure);
    if (!this.result) throw invalid();
    return copyResult(this.result);
  }
}

// Browser-compatible byte parser. Retained fragments are copied so a reused
// input buffer cannot rewrite a partially received frame. No HTML, timer,
// reconnect, network request, store or action is performed by this decoder.
export class OwnerChatDecoder {
  private readonly cursor: OwnerChatFrameCursor;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private parts: Uint8Array[] = [];
  private lineBytes = 0; private bytes = 0; private chunks = 0; private empty = 0; private closed = false; private poisoned = false;
  constructor(expected: OwnerChatScope) { this.cursor = new OwnerChatFrameCursor(expected); }
  push(chunk: Uint8Array): Readonly<ChatTextEvent>[] {
    try {
      if (this.closed || this.poisoned || !(chunk instanceof Uint8Array) || ++this.chunks > OWNER_CHAT_LIMITS.chunks
        || (this.bytes += chunk.byteLength) > OWNER_CHAT_LIMITS.bytes) throw invalid();
      this.empty = chunk.byteLength ? 0 : this.empty + 1;
      if (this.empty > OWNER_CHAT_LIMITS.emptyChunks) throw invalid();
      const events: Readonly<ChatTextEvent>[] = [];
      const append = (part: Uint8Array) => {
        this.lineBytes += part.byteLength;
        if (this.lineBytes + 1 > OWNER_CHAT_LIMITS.frameBytes) throw invalid();
        if (part.byteLength) this.parts.push(part.slice());
      };
      let offset = 0;
      while (offset < chunk.byteLength) {
        const end = chunk.indexOf(10, offset);
        if (end === -1) { append(chunk.subarray(offset)); break; }
        append(chunk.subarray(offset, end));
        const line = new Uint8Array(this.lineBytes); let at = 0;
        for (const part of this.parts) { line.set(part, at); at += part.byteLength; }
        this.parts = []; this.lineBytes = 0;
        const accepted = this.cursor.accept(JSON.parse(this.decoder.decode(line)) as unknown);
        if (accepted) events.push(accepted);
        offset = end + 1;
      }
      return events;
    } catch { this.poisoned = true; this.parts = []; this.lineBytes = 0; throw invalid(); }
  }
  finish(): ChatResult {
    if (this.closed || this.poisoned || this.lineBytes || this.parts.length) { this.poisoned = true; this.parts = []; throw invalid(); }
    this.closed = true; return this.cursor.finish();
  }
}
