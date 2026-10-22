import { z } from 'zod';
import { AppError } from '../shared/types.js';
import { contentReport, contentSnapshotSchema, type SavedContentReport } from './content.js';
import { contentStatusRows, type ContentStatusGroup } from './content-status.js';

const inputSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid().nullable(), createdAt: z.iso.datetime(),
  snapshot: contentSnapshotSchema, generatedOn: z.string().length(10) }).strict();
const day = (value: string) => value.split('-').reverse().join('.');
// Export is plain text. Source cells cannot inject a new heading or hide text
// with terminal/bidirectional controls. No HTML, Markdown links or TSV formulas.
const cell = (value: string) => value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
const stageNames = { metin: 'Metin', ses: 'Ses', kurgu: 'Kurgu', kapak: 'Kapak' } as const;
const state = { ready: 'Hazır', missing: 'Eksik', unknown: 'Bilinmiyor' } as const;

export function contentReportText(saved: SavedContentReport, includeRows = false): string {
  const value = inputSchema.parse({ id: saved.id, projectId: saved.projectId, createdAt: saved.createdAt, snapshot: saved.snapshot, generatedOn: saved.report.generatedOn });
  // Rebuild from validated saved input; UI strings and fabricated counts are
  // never the source of an export. The saved evaluation date stays unchanged.
  const report = contentReport(value.snapshot, value.generatedOn), rows = contentStatusRows(value.snapshot, value.generatedOn);
  const stamp = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value.createdAt));
  const counts = (group: ContentStatusGroup) => rows.filter(item => item.groups.includes(group)).length;
  const lines = [
    `LOCAL WORKSPACE KIT · İÇERİK RAPORU`, `Kaynak: ${cell(report.sourceLabel)}`, `Veri tarihi: ${day(report.observedOn)}`,
    `Değerlendirme tarihi: ${day(report.generatedOn)}`, `Kayıt zamanı: ${stamp} · İstanbul`, `Rapor kimliği: ${value.id}`,
    'Kayıtlı tabloya dayanır. Hesap veya web sayfası canlı kontrol edilmedi.', '',
    `ÖZET · ${report.counts.total} içerik`,
    `Yayınlanmış: ${report.counts.published} · Yayınlanmamış: ${report.counts.active} · Yayın durumu bilinmeyen: ${report.counts.unknownPublication}`,
    `Teslimi geciken: ${counts('overdue')} · Teslimi 7 gün içinde: ${counts('due-soon')} · Üretimi eksik: ${counts('missing')} · Bilgisi doğrulanacak: ${counts('needs-check')}`,
    'Durum grupları kesişebilir; toplamları ayrı içerik sayısı değildir.', '', 'ÖNCE BAKILACAK İŞLER'
  ];
  if (!report.priorities.length) lines.push('Bekleyen içerik bulunmadı.');
  for (const [index, item] of report.priorities.entries()) {
    lines.push(`${index + 1}. İçerik: ${cell(item.title)}${item.tentative ? ' · doğrulanmalı' : ''}`);
    for (const reason of item.reason) lines.push(`   - ${cell(reason)}`);
    lines.push(`   Sonraki adım: ${cell(item.nextStep)}`, `   Kaynak satırı: ${cell(item.reference)}`, '');
  }
  if (report.warnings.length) { lines.push('', 'VERİ SINIRLARI'); for (const warning of report.warnings) lines.push(`- ${cell(warning)}`); }
  if (includeRows) {
    lines.push('', 'BÜTÜN KAYITLI İÇERİKLER');
    for (const { row, daysToDeadline } of rows) {
      const publication = row.published === null ? 'Bilinmiyor; doğrula' : row.published ? 'Yayınlanmış olarak işaretli' : 'Yayınlanmamış olarak işaretli';
      const deadline = daysToDeadline === null ? 'Bilinmiyor' : `${day(row.deadline!)} · ${daysToDeadline < 0 ? `${-daysToDeadline} gün geçmiş` : daysToDeadline === 0 ? 'değerlendirme günü' : `${daysToDeadline} gün kalmış`}`;
      lines.push(`İçerik: ${cell(row.title)}`, `  Yayın: ${publication} · Teslim: ${deadline}`,
        `  Çıkış tarihi: ${row.release ? day(row.release) : 'Bilinmiyor'} · Key durumu: ${cell(row.keyStatus) || 'Bilinmiyor'}`,
        `  ${Object.entries(stageNames).map(([id, label]) => `${label}: ${state[row.stages[id as keyof typeof stageNames]]}`).join(' · ')}`,
        `  Kaynak satırı: ${cell(row.reference)}`, '');
    }
  }
  lines.push('', 'Bu metni paylaşmadan önce içeriğini kontrol et. Uygulama kendiliğinden göndermez.');
  const text = lines.join('\n');
  if (text.length > 256_000) throw new AppError('REPORT_TEXT_LIMIT', 'Rapor metni sınırı aşıldı; kısa özeti kullan.');
  return text;
}
