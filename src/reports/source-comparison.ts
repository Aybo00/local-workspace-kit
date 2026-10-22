import { z } from 'zod';
import { AppError, type Source } from '../shared/types.js';

export interface SourceCapture { conversationId: string; source: Source }
export interface SourceChange { kind: 'added' | 'removed'; line: number; text: string; clipped: boolean }
export interface SourceComparison {
  url: string; beforeReadAt: string; afterReadAt: string; beforeTitle: string; afterTitle: string;
  textChanged: boolean; titleChanged: boolean; bounded: boolean;
  addedLines: number | null; removedLines: number | null; omittedChanges: number;
  changes: SourceChange[]; warnings: string[];
}
const sourceSchema = z.object({ id: z.string().uuid(), url: z.string().max(4096), title: z.string().max(200),
  text: z.string().min(1).max(40_000), readAt: z.iso.datetime(), truncated: z.boolean() }).strict();
const captureSchema = z.object({ conversationId: z.string().uuid(), source: sourceSchema }).strict();

// Identity only. This neither approves a request nor resolves/opens the URL.
// Keep query, path case and encoding significant; fragments are not sent in HTTP.
export function sourceIdentity(raw: string): string {
  if (raw.length > 4096) throw new AppError('SOURCE_URL', 'Kaynak adresi çok uzun.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new AppError('SOURCE_URL', 'Kaynak adresi geçerli değil.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('SOURCE_URL', 'Yalnız kimlik bilgisi içermeyen HTTPS kaynakları karşılaştırılır.');
  url.hash = ''; return url.href;
}

// Two already-opened, same-conversation captures only. No I/O, model, timers,
// persistence, approval issuance or mutation. LCS is capped at 400 x 400 cells.
export function compareSources(older: SourceCapture, newer: SourceCapture): SourceComparison {
  const before = captureSchema.parse(older), after = captureSchema.parse(newer);
  const left = before.source, right = after.source, url = sourceIdentity(left.url);
  if (before.conversationId !== after.conversationId) throw new AppError('COMPARE_SCOPE', 'Yalnız aynı sohbetin kaynak kayıtları karşılaştırılabilir.');
  if (left.id === right.id) throw new AppError('COMPARE_SAME', 'Aynı kaynak kaydı kendisiyle karşılaştırılamaz.');
  if (url !== sourceIdentity(right.url)) throw new AppError('COMPARE_SOURCE', 'Yalnız aynı tam web adresinin iki okuması karşılaştırılır.');
  if (Date.parse(left.readAt) >= Date.parse(right.readAt)) throw new AppError('COMPARE_ORDER', 'Önceki okuma daha eski olmalı; okuma tarihlerini kontrol et.');
  const a = left.text.replace(/\r\n/g, '\n').split('\n'), b = right.text.replace(/\r\n/g, '\n').split('\n');
  const result: SourceComparison = { url, beforeReadAt: left.readAt, afterReadAt: right.readAt,
    beforeTitle: left.title, afterTitle: right.title, textChanged: a.join('\n') !== b.join('\n'), titleChanged: left.title !== right.title,
    bounded: false, addedLines: 0, removedLines: 0, omittedChanges: 0, changes: [],
    warnings: ['Yalnız kayıtlı okunabilir metin karşılaştırıldı; sayfanın görselleri, kodu ve hesabındaki durum kontrol edilmedi.'] };
  if (left.truncated || right.truncated) result.warnings.push('Okumalardan en az biri kısaltılmış; metnin devamındaki değişiklikler bilinmiyor.');
  const add = (kind: SourceChange['kind'], line: number, text: string) => {
    if (result.changes.length < 12) result.changes.push({ kind, line, text: text.slice(0, 700), clipped: text.length > 700 });
    else result.omittedChanges++;
  };
  if (!result.textChanged) return result;
  if (a.length > 400 || b.length > 400) {
    // Avoid quadratic work on hostile pages. Show one changed region from each
    // capture, explicitly without claiming complete line counts or full diff.
    result.bounded = true; result.addedLines = result.removedLines = null;
    let prefix = 0, suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    if (prefix < a.length - suffix) add('removed', prefix + 1, a.slice(prefix, a.length - suffix).join('\n'));
    if (prefix < b.length - suffix) add('added', prefix + 1, b.slice(prefix, b.length - suffix).join('\n'));
    result.warnings.push('Sayfa çok satırlı: yalnız değişen bölgenin başlangıcı gösteriliyor; tam fark veya değişiklik sayısı hesaplanmadı.');
    return result;
  }
  const width = b.length + 1, lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lcs[i * width + j] = a[i] === b[j] ? 1 + lcs[(i + 1) * width + j + 1]! : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  }
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; }
    else if (j < b.length && (i === a.length || lcs[i * width + j + 1]! > lcs[(i + 1) * width + j]!)) {
      result.addedLines!++; add('added', j + 1, b[j++]!);
    } else { result.removedLines!++; add('removed', i + 1, a[i++]!); }
  }
  return result;
}
