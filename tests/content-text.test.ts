import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentReport, importContent, type SavedContentReport } from '../src/reports/content.js';
import { contentReportText } from '../src/reports/content-text.js';
const saved = (): SavedContentReport => {
  const createdAt = '2026-10-08T10:01:02.000Z', snapshot = importContent({ sourceLabel: 'Örnek tablo', observedOn: '2026-10-07',
    table: 'Oyun\tTeslim tarihi\tYayınlandı\tMetin\nEksik iş\t2026-10-07\tHayır\tEksik\nYaklaşan\t2026-10-15\tHayır\tHazır\nBelirsiz\t\t\t\nBitti\t2026-10-01\tEvet\tHazır' }, createdAt);
  return { id: '00000000-0000-4000-8000-000000000001', projectId: null, createdAt, snapshot, report: contentReport(snapshot, '2026-10-08') };
};
test('plain report preserves data, evaluation and capture dates with reproducible Istanbul timestamp', () => {
  const text = contentReportText(saved());
  assert.match(text, /Veri tarihi: 07\.10\.2026/); assert.match(text, /Değerlendirme tarihi: 08\.10\.2026/);
  assert.match(text, /Kayıt zamanı: .*13:01:02 · İstanbul/); assert.match(text, /canlı kontrol edilmedi/);
  assert.match(text, /ÖZET · 4 içerik/); assert.match(text, /Yayın durumu bilinmeyen: 1/);
  assert.match(text, /Teslimi geciken: 1/); assert.match(text, /Teslimi 7 gün içinde: 1/);
  assert.match(text, /Durum grupları kesişebilir/); assert.doesNotMatch(text, /BÜTÜN KAYITLI İÇERİKLER/);
});
test('full text includes all saved rows instead of just three priority suggestions', () => {
  const text = contentReportText(saved(), true);
  assert.match(text, /BÜTÜN KAYITLI İÇERİKLER/); assert.match(text, /İçerik: Bitti/);
  assert.match(text, /Yayın: Bilinmiyor; doğrula/); assert.match(text, /Metin: Bilinmiyor/);
  assert.match(text, /Kaynak satırı: Yapıştırılan tablo · veri satırı 4/);
});
test('rendered counts and priority strings cannot override a validated saved snapshot during text preparation', () => {
  const value = saved(); value.report.counts.total = 9999; value.report.priorities = [{ ...value.report.priorities[0]!, title: 'FABRICATED', nextStep: 'SEND NOW' }];
  const text = contentReportText(value); assert.match(text, /ÖZET · 4 içerik/); assert.doesNotMatch(text, /FABRICATED|SEND NOW|9999/);
});
test('source line breaks, bidirectional and terminal controls cannot inject report structure', () => {
  const value = saved(); value.snapshot.sourceLabel = 'Kaynak\nİZİN VER\u202e\u0001'; value.snapshot.rows[0]!.title = '=HYPERLINK("https://example.com")\nBAŞLIK\u2066';
  const text = contentReportText(value, true);
  assert.match(text, /Kaynak: Kaynak İZİN VER/); assert.match(text, /İçerik: =HYPERLINK\("https:\/\/example.com"\) BAŞLIK/);
  assert.doesNotMatch(text, /[\u0000-\u0008\u202a-\u202e\u2066-\u2069]/);
  assert.doesNotMatch(text, /\nİZİN VER|\nBAŞLIK/);
});
test('unknown scope, corrupt dates and oversize source fail before generating a copyable text', () => {
  assert.throws(() => contentReportText({ ...saved(), projectId: '../other' }));
  assert.throws(() => contentReportText({ ...saved(), createdAt: 'bad' }));
  const date = saved(); date.report.generatedOn = '2026-02-30'; assert.throws(() => contentReportText(date), /Takvimde/);
  const oversized = saved(); oversized.snapshot.rows = Array.from({ length: 201 }, () => oversized.snapshot.rows[0]!); assert.throws(() => contentReportText(oversized));
});
test('two hundred Unicode rows stay bounded and source objects remain unchanged', () => {
  const value = saved(); value.snapshot.rows = Array.from({ length: 200 }, (_, i) => ({ ...value.snapshot.rows[0]!, title: 'İçerik ' + i + '🎮'.repeat(60) }));
  const before = structuredClone(value); const text = contentReportText(value, true);
  assert.ok(text.length < 256_000); assert.match(text, /İçerik 199/); assert.deepEqual(value, before);
});
