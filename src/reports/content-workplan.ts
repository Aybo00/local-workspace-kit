import { civilDay, contentSnapshotSchema, type ContentSnapshot } from './content.js';
import { nextContentAction, productionStages, type ContentAction, type ProductionStage } from './content-actions.js';
import { AppError } from '../shared/types.js';

export type ContentAttention = 'overdue' | 'today' | 'soon' | 'scheduled' | 'undated';
export interface ContentWorkItem {
  sourceRow: number; reference: string; title: string; deadline: string | null; daysToDeadline: number | null;
  attention: ContentAttention; publicationUnknown: boolean; action: ContentAction;
}
export interface ContentWorkplan {
  sourceLabel: string; observedOn: string; evaluatedOn: string; sourceAgeDays: number;
  freshness: 'recent' | 'stale' | 'future';
  counts: { total: number; published: number; pending: number; publicationUnknown: number; urgent: number; verifyFirst: number };
  stages: { stage: ProductionStage; label: string; missing: number; unknown: number }[];
  items: ContentWorkItem[]; warnings: string[];
}
export const workplanFilters = [
  { id: 'all', label: 'Bütün bekleyenler' }, { id: 'urgent', label: 'Teslimi yakın veya geçmiş' },
  { id: 'verify', label: 'Önce doğrulanacaklar' }
] as const;
export type WorkplanFilter = typeof workplanFilters[number]['id'];
const urgency = { overdue: 0, today: 1, soon: 2, scheduled: 3, undated: 4 } as const;
const urgent = (item: ContentWorkItem) => ['overdue', 'today', 'soon'].includes(item.attention);
const verify = (item: ContentWorkItem) => item.action.kind !== 'complete-stage';

// Ephemeral, deterministic owner-report view. No model, Date.now, storage,
// scheduler, account access or new authority. Always use the saved evaluation
// day; opening an archived report must not silently turn it into today's plan.
export function contentWorkplan(raw: ContentSnapshot, asOf: string): ContentWorkplan {
  const snapshot = contentSnapshotSchema.parse(raw), day = civilDay(asOf);
  const sourceAgeDays = day - civilDay(snapshot.observedOn);
  const freshness = sourceAgeDays < 0 ? 'future' : sourceAgeDays > 1 ? 'stale' : 'recent';
  const stages = productionStages.map(stage => ({ stage: stage.id, label: stage.label, missing: 0, unknown: 0 }));
  const counts = { total: snapshot.rows.length, published: 0, pending: 0, publicationUnknown: 0, urgent: 0, verifyFirst: 0 };
  const items: ContentWorkItem[] = [];
  for (const [index, row] of snapshot.rows.entries()) {
    const action = nextContentAction(row, sourceAgeDays);
    if (!action) { counts.published++; continue; }
    counts.pending++;if (row.published === null) counts.publicationUnknown++;
    // Only explicitly unpublished rows contribute to production bottlenecks;
    // unknown publication is a verification need, not unfinished production.
    if (row.published === false) {
      const stage = stages.find(value => row.stages[value.stage] !== 'ready');
      if (stage && row.stages[stage.stage] === 'missing') stage.missing++;
      else if (stage) stage.unknown++;
    }
    const daysToDeadline = row.deadline === null ? null : civilDay(row.deadline) - day;
    const attention: ContentAttention = daysToDeadline === null ? 'undated' : daysToDeadline < 0 ? 'overdue'
      : daysToDeadline === 0 ? 'today' : daysToDeadline <= 7 ? 'soon' : 'scheduled';
    items.push({ sourceRow: index + 1, reference: row.reference, title: row.title, deadline: row.deadline, daysToDeadline,
      attention, publicationUnknown: row.published === null, action });
  }
  items.sort((a, b) => urgency[a.attention] - urgency[b.attention] ||
    (a.daysToDeadline ?? 0) - (b.daysToDeadline ?? 0) || a.sourceRow - b.sourceRow);
  counts.urgent = items.filter(urgent).length;counts.verifyFirst = items.filter(verify).length;
  const warnings = [...snapshot.warnings, 'Yalnız bu kayıtlı tablo değerlendirildi; hesap veya web sayfası canlı kontrol edilmedi.',
    'Teslim önceliği üretim talimatı değildir; yayın durumu bilinmeyen içerik önce doğrulanır.',
    'Aşama sayıları, yayınlanmadığı açıkça işaretli içeriklerin ilk açık aşamasıdır; toplam eksik adım veya iş süresi değildir.'];
  if (freshness === 'stale') warnings.push(`Veri değerlendirme tarihinden ${sourceAgeDays} gün eski; önce tablonun son halini doğrula.`);
  if (freshness === 'future') warnings.push('Veri tarihi değerlendirme tarihinden sonra; önce tarihi doğrula.');
  return { sourceLabel: snapshot.sourceLabel, observedOn: snapshot.observedOn, evaluatedOn: asOf, sourceAgeDays, freshness, counts, stages, items, warnings };
}

export function workplanItems(plan: ContentWorkplan, filter: WorkplanFilter): ContentWorkItem[] {
  return plan.items.filter(item => filter === 'urgent' ? urgent(item) : filter === 'verify' ? verify(item) : true);
}

export const workplanLabel = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
const dateLabel = (value: string) => value.split('-').reverse().join('.');
export function workItemDeadline(item: ContentWorkItem): string {
  const days = item.daysToDeadline;
  return days === null ? 'Teslim tarihi bilinmiyor' : `Teslim: ${dateLabel(item.deadline!)} · ` +
    (days < 0 ? `${-days} gün geçmiş` : days === 0 ? 'değerlendirme günü' : `${days} gün kalmış`);
}

// Recompute from validated snapshot, never trust UI counts or model-written
// tasks. Plain text only; no clipboard, file export or external send occurs.
export function contentWorkplanText(snapshot: ContentSnapshot, asOf: string): string {
  const plan = contentWorkplan(snapshot, asOf), lines = ['LOCAL WORKSPACE KIT · SIRADAKİ İŞLER', `Kaynak: ${workplanLabel(plan.sourceLabel)}`,
    `Veri: ${dateLabel(plan.observedOn)} · Değerlendirme: ${dateLabel(plan.evaluatedOn)}`,
    `${plan.counts.pending} bekleyen · ${plan.counts.publicationUnknown} yayın durumu bilinmeyen · ${plan.counts.published} yayınlanmış olarak işaretli`,
    'Bu bir öneri listesidir; takvim, rutin veya işlem oluşturulmadı.', '', 'KAYITTAKİ İLK AÇIK AŞAMALAR'];
  for (const stage of plan.stages) lines.push(`${stage.label}: ${stage.missing} eksik olarak işaretli · ${stage.unknown} durumu bilinmeyen`);
  lines.push('', 'ÖNCELİK SIRASI');
  if (!plan.items.length) lines.push('Kayıtta bekleyen içerik görünmüyor; canlı yayın durumu doğrulanmadı.');
  for (const [index, item] of plan.items.entries()) lines.push(`${index + 1}. ${workplanLabel(item.title)}`, `   ${workItemDeadline(item)}`,
    `   ${item.publicationUnknown ? 'Yayın durumu bilinmiyor; önce doğrula.' : 'Kayıtta yayınlanmamış olarak işaretli.'}`,
    `   Öneri: ${item.action.instruction}`, `   Kaynak satırı: ${workplanLabel(item.reference)} · kayıt sırası ${item.sourceRow}`, '');
  lines.push('', 'VERİ SINIRLARI');for (const warning of plan.warnings) lines.push(`- ${workplanLabel(warning)}`);
  lines.push('', 'Paylaşmadan önce kontrol et; uygulama kendiliğinden göndermez.');
  const text = lines.join('\n');
  if (text.length > 256_000) throw new AppError('REPORT_TEXT_LIMIT', 'Çalışma listesi metin sınırını aştı; tablonun kapsamını daralt.');
  return text;
}
