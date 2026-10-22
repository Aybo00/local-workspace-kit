import { z } from 'zod';
import { AppError } from '../shared/types.js';
import { civilDay, contentSnapshotSchema, type ContentRow, type SavedContentReport } from './content.js';

type ReportInput = Pick<SavedContentReport, 'id' | 'projectId' | 'createdAt' | 'snapshot'>;
export interface ContentDifference {
  title: string; beforeReference: string; afterReference: string;
  fields: { label: string; before: string; after: string }[];
}
export interface ContentComparison {
  sourceLabel: string; beforeId: string; afterId: string; beforeObservedOn: string; afterObservedOn: string;
  counts: { before: number; after: number; added: number; absent: number; changed: number; unchanged: number; ambiguousNames: number };
  added: { title: string; reference: string }[]; absent: { title: string; reference: string }[];
  changed: ContentDifference[];
  overdue: { title: string; reference: string; days: number; publicationUnknown: boolean; newSincePrevious: boolean | null }[];
  warnings: string[];
}
const inputSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid().nullable(),
  createdAt: z.iso.datetime(), snapshot: contentSnapshotSchema }).strict();
const identity = (value: string) => value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/\s+/g, ' ');
const readinessLabel = { ready: 'Hazır', missing: 'Eksik', unknown: 'Bilinmiyor' };
const publication = (value: boolean | null) => value === null ? 'Bilinmiyor' : value ? 'Yayınlanmış' : 'Yayınlanmamış';
const dateLabel = (value: string | null) => value ? value.split('-').reverse().join('.') : 'Bilinmiyor';
function index(rows: ContentRow[]): Map<string, ContentRow[]> {
  const result = new Map<string, ContentRow[]>();
  for (const row of rows) { const key = identity(row.title); const list = result.get(key) ?? []; list.push(row); result.set(key, list); }
  return result;
}
function late(row: ContentRow, asOf: string): boolean { return row.published !== true && row.deadline !== null && civilDay(row.deadline) < civilDay(asOf); }
function rowDifferences(before: ContentRow, after: ContentRow): ContentDifference['fields'] {
  const fields: ContentDifference['fields'] = [];
  const add = (label: string, left: string, right: string) => { if (left !== right) fields.push({ label, before: left, after: right }); };
  add('İçerik adı', before.title, after.title);
  add('Teslim tarihi', dateLabel(before.deadline), dateLabel(after.deadline));
  add('Çıkış tarihi', dateLabel(before.release), dateLabel(after.release));
  add('Yayın durumu', publication(before.published), publication(after.published));
  add('Key durumu', before.keyStatus || 'Bilinmiyor', after.keyStatus || 'Bilinmiyor');
  for (const [stage, label] of Object.entries({ metin: 'Metin', ses: 'Ses', kurgu: 'Kurgu', kapak: 'Kapak' }) as [keyof ContentRow['stages'], string][]) {
    add(label, readinessLabel[before.stages[stage]], readinessLabel[after.stages[stage]]);
  }
  return fields;
}
// Pure, bounded comparison of two supplied report snapshots.
// No provider, storage, network, timer, automatic baseline or permission change.
export function compareContentReports(older: ReportInput, newer: ReportInput): ContentComparison {
  const read = (value: ReportInput) => inputSchema.parse({ id: value.id, projectId: value.projectId, createdAt: value.createdAt, snapshot: value.snapshot });
  const before = read(older), after = read(newer);
  if (before.id === after.id) throw new AppError('COMPARE_SAME', 'Aynı kayıt kendisiyle karşılaştırılamaz. Daha yeni bir rapor aç.');
  if (before.projectId !== after.projectId) throw new AppError('COMPARE_SCOPE', 'Yalnız aynı çalışma alanındaki kayıtlar karşılaştırılabilir.');
  if (identity(before.snapshot.sourceLabel) !== identity(after.snapshot.sourceLabel)) throw new AppError('COMPARE_SOURCE', 'Aynı tablonun iki kaydını seç; farklı tablo adları karşılaştırılmaz.');
  if (Date.parse(before.createdAt) >= Date.parse(after.createdAt) || civilDay(before.snapshot.observedOn) > civilDay(after.snapshot.observedOn)) {
    throw new AppError('COMPARE_ORDER', 'Önceki kayıt daha eski olmalı. Önce eski raporu seç, sonra daha yeni raporu aç.');
  }
  const oldRows = index(before.snapshot.rows), newRows = index(after.snapshot.rows), ambiguous = new Set<string>();
  for (const [key, rows] of [...oldRows, ...newRows]) if (rows.length > 1) ambiguous.add(key);
  const counts = { before: before.snapshot.rows.length, after: after.snapshot.rows.length, added: 0, absent: 0, changed: 0, unchanged: 0, ambiguousNames: ambiguous.size };
  const result: ContentComparison = { sourceLabel: after.snapshot.sourceLabel, beforeId: before.id, afterId: after.id,
    beforeObservedOn: before.snapshot.observedOn, afterObservedOn: after.snapshot.observedOn, counts,
    added: [], absent: [], changed: [], overdue: [], warnings: [
      'Yalnız saklanan iki tablo karşılaştırıldı; Google Sheets veya başka hesap canlı kontrol edilmedi.',
      'Eşleştirme benzersiz içerik adına göre yapılır. Adı değişen içerik yeni/görünmeyen olarak çıkabilir; görünmemek silindiği anlamına gelmez.',
      ...before.snapshot.warnings.map(value => 'Önceki kayıt: ' + value),
      ...after.snapshot.warnings.map(value => 'Yeni kayıt: ' + value)
    ] };
  if (ambiguous.size) result.warnings.push(ambiguous.size + ' içerik adı birden çok satırda geçiyor. Bu adlar için eklenen/görünmeyen/değişen eşleştirmesi yapılmadı; satırları ayırt edecek adlar kullan.');
  for (const row of after.snapshot.rows) {
    const key = identity(row.title), previous = ambiguous.has(key) ? undefined : oldRows.get(key)?.[0];
    if (!ambiguous.has(key)) {
      if (!previous) result.added.push({ title: row.title, reference: row.reference });
      else {
        const fields = rowDifferences(previous, row);
        if (fields.length) result.changed.push({ title: row.title, beforeReference: previous.reference, afterReference: row.reference, fields });
        else counts.unchanged++;
      }
    }
    if (late(row, after.snapshot.observedOn)) result.overdue.push({ title: row.title, reference: row.reference,
      days: civilDay(after.snapshot.observedOn) - civilDay(row.deadline!), publicationUnknown: row.published === null,
      newSincePrevious: previous ? !late(previous, before.snapshot.observedOn) : null });
  }
  for (const row of before.snapshot.rows) if (!ambiguous.has(identity(row.title)) && !newRows.has(identity(row.title))) result.absent.push({ title: row.title, reference: row.reference });
  counts.added = result.added.length; counts.absent = result.absent.length; counts.changed = result.changed.length;
  result.overdue.sort((a, b) => b.days - a.days || a.title.localeCompare(b.title, 'tr'));
  return result;
}
