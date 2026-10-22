import { AppError, type ModelReply } from '../shared/types.js';
import { CHAT_TEXT_LIMITS, ChatTextCursor, type ChatTextEvent, type ChatTextReceiver } from '../shared/chat-stream.js';

const invalid = () => new AppError('BAD_RESPONSE', 'Modelin geçici yanıtı ve tamamlanmış metni eşleşmedi.');
const deliveryFailed = () => new AppError('CHAT_STREAM_DELIVERY_FAILED', 'Yanıt bağlantısı doğrulanamadı. Görev otomatik tekrar gönderilmedi.');

// One instance per runtime job, one generation per execution attempt.
// A reset is awaited before any text, including a restarted attempt.
// No timer, replay, persistence or authority is added by presentation events.
export class ChatTextStream {
  private generation = 0; private closed = false; private failed = false;
  private stopCurrent?: () => void;
  private readonly cursor = new ChatTextCursor();
  constructor(private receive: ChatTextReceiver, private jobSignal: AbortSignal) {}
  throwDeliveryFailure(): void { if (this.failed) throw deliveryFailed(); }
  close(): void { this.closed = true; this.stopCurrent?.(); }
  async begin(phase: AbortSignal, modelLabel: string) {
    this.stopCurrent?.();
    const generation = ++this.generation;
    let active = true, writing = false, sequence = 0;
    const scope = new AbortController(), deliverySignal = AbortSignal.any([phase, this.jobSignal, scope.signal]);
    const close = () => { active = false; scope.abort(new AppError('CHAT_STREAM_STALE', 'Eski yanıt aşaması kapandı.')); };
    this.stopCurrent = close;
    const check = () => {
      deliverySignal.throwIfAborted(); this.throwDeliveryFailure();
      if (this.closed || !active || generation !== this.generation) throw new AppError('CHAT_STREAM_STALE', 'Eski yanıt aşaması kapandı.');
    };
    const emit = async (event: ChatTextEvent): Promise<void> => {
      check(); if (writing) throw invalid(); writing = true;
      try {
        try { this.cursor.accept(event); } catch { throw invalid(); }
        // An observer cannot strand model cleanup after cancel/pause/deadline.
        // It receives a signal for this exact attempt; a transport must honor it
        // before writing and after every awaited socket backpressure boundary.
        try {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => deliverySignal.removeEventListener('abort', abort);
            const abort = () => { cleanup(); reject(deliverySignal.reason); };
            deliverySignal.addEventListener('abort', abort, { once: true });
            Promise.resolve().then(() => { check(); return this.receive(Object.freeze(event), deliverySignal); })
              .then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
            if (deliverySignal.aborted) abort();
          });
          check();
        } catch (error) {
          // Observer-supplied AppError codes are untrusted too. In particular a
          // consumer throwing BAD_RESPONSE must not authorize model fallback.
          if (!deliverySignal.aborted) { this.failed = true; throw deliveryFailed(); }
          throw error;
        }
      } finally { writing = false; }
    };
    try { await emit({ type: 'reset', generation, modelLabel }); } catch (error) { close(); throw error; }
    return {
      text: async (delta: string) => {
        check();
        if (typeof delta !== 'string' || !delta.length || delta.length > CHAT_TEXT_LIMITS.text) throw invalid();
        for (let offset = 0; offset < delta.length;) {
          let end = Math.min(offset + CHAT_TEXT_LIMITS.delta, delta.length);
          if (end < delta.length && /[\uD800-\uDBFF]/u.test(delta[end - 1]!) && /[\uDC00-\uDFFF]/u.test(delta[end]!)) end--;
          await emit({ type: 'text', generation, sequence: ++sequence, delta: delta.slice(offset, end) }); offset = end;
        }
      },
      finish: (reply: ModelReply, streamed: boolean) => {
        check();
        if (writing || reply.toolCalls.length || !reply.content.trim() || reply.content.length > CHAT_TEXT_LIMITS.text
          || (streamed && reply.content !== this.cursor.text)) throw invalid();
        active = false;
      },
      close
    };
  }
}
