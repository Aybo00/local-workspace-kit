// Optional transient presentation protocol. No persisted schema, permissions,
// tools, reasoning, credentials, prompt or cross-conversation subscription.
export type ChatTextEvent = { type: 'reset'; generation: number; modelLabel: string }
  | { type: 'text'; generation: number; sequence: number; delta: string };
export type ChatTextReceiver = (event: Readonly<ChatTextEvent>, signal: AbortSignal) => void | Promise<void>;
// Separate optional presentation capability; frozen storage/desktop Bridge
// types do not change. A request owns its receiver until clean completion.
export interface ChatTextBridge {
  chatWithText?(input: import('./types.js').ChatInput, receive: ChatTextReceiver, signal?: AbortSignal): Promise<import('./types.js').ChatResult>;
}
export const CHAT_TEXT_LIMITS = Object.freeze({ generations: 32, text: 100000, delta: 2048, events: 32768, totalText: 1000000 });

export function validChatTextEvent(value: unknown): value is ChatTextEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (!Number.isSafeInteger(event.generation) || (event.generation as number) < 1 || (event.generation as number) > CHAT_TEXT_LIMITS.generations) return false;
  if (event.type === 'reset') return Object.keys(event).sort().join(',') === 'generation,modelLabel,type'
    && typeof event.modelLabel === 'string' && event.modelLabel.length > 0 && event.modelLabel.length <= 240
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(event.modelLabel);
  return event.type === 'text' && Object.keys(event).sort().join(',') === 'delta,generation,sequence,type'
    && Number.isSafeInteger(event.sequence) && (event.sequence as number) >= 1 && (event.sequence as number) <= CHAT_TEXT_LIMITS.events
    && typeof event.delta === 'string' && event.delta.length > 0 && event.delta.length <= CHAT_TEXT_LIMITS.delta;
}

// The consumer also checks order and bounds. An old generation is ignored;
// duplicate, missing or future frames in the current turn are protocol errors.
export class ChatTextCursor {
  private generation = 0; private sequence = 0; private received = 0; private totalText = 0;
  private content = ''; private label = '';
  get text(): string { return this.content; }
  get modelLabel(): string { return this.label; }
  accept(raw: unknown): ChatTextEvent | null {
    if (!validChatTextEvent(raw)) throw new Error('Yanıt akışı doğrulanamadı.');
    if (raw.generation < this.generation) return null;
    if (this.received >= CHAT_TEXT_LIMITS.events) throw new Error('Yanıt akışı sınırına ulaşıldı.');
    if (raw.type === 'reset') {
      if (raw.generation !== this.generation + 1) throw new Error('Yanıtın yeni aşaması doğrulanamadı.');
      this.generation = raw.generation; this.sequence = 0; this.content = ''; this.label = raw.modelLabel;
    } else {
      if (raw.generation !== this.generation || raw.sequence !== this.sequence + 1
        || this.content.length + raw.delta.length > CHAT_TEXT_LIMITS.text || this.totalText + raw.delta.length > CHAT_TEXT_LIMITS.totalText)
        throw new Error('Yanıtın sırası veya metin sınırı doğrulanamadı.');
      this.sequence = raw.sequence; this.content += raw.delta; this.totalText += raw.delta.length;
    }
    this.received++; return raw;
  }
}
