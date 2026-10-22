import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importContent } from '../src/reports/content.js';
import { compareContentReports } from '../src/reports/comparison.js';

function report(table: string, day: '07' | '08', sourceLabel = 'Kanalım', projectId: string | null = null) {
  const createdAt = '2026-10-' + day + 'T10:00:00.000Z';
  return { id: randomUUID(), projectId, createdAt,
    snapshot: importContent({ sourceLabel, observedOn: '2026-10-' + day, table }, createdAt) };
}
test('row reorder is not a change; real stage/date/publication changes carry both source references', () => {
  const old = report('Oyun\tMetin\tTeslim tarihi\tYayınlandı\nA\tEksik\t09.10.2026\tHayır\nB\tHazır\t\tEvet', '07');
  const next = report('Oyun\tMetin\tTeslim tarihi\tYayınlandı\nB\tHazır\t\tEvet\nA\tHazır\t10.10.2026\tEvet', '08');
  const original = structuredClone([old, next]), delta = compareContentReports(old, next);
  assert.deepEqual(delta.counts, { before: 2, after: 2, added: 0, absent: 0, changed: 1, unchanged: 1, ambiguousNames: 0 });
  assert.equal(delta.changed[0]!.beforeReference, 'Yapıştırılan tablo · veri satırı 1');
  assert.equal(delta.changed[0]!.afterReference, 'Yapıştırılan tablo · veri satırı 2');
  assert.deepEqual(delta.changed[0]!.fields.map(field => field.label), ['Teslim tarihi', 'Yayın durumu', 'Metin']);
  assert.deepEqual([old, next], original, 'comparison must not mutate either archived snapshot');
});
test('missing and renamed rows are not asserted deleted; unknown cells remain unknown', () => {
  const delta = compareContentReports(report('Oyun\tMetin\nEski ad\tHazır\nA\tEksik', '07'), report('Oyun\tMetin\nYeni ad\tHazır\nA\t', '08'));
  assert.deepEqual(delta.added.map(row => row.title), ['Yeni ad']); assert.deepEqual(delta.absent.map(row => row.title), ['Eski ad']);
  assert.deepEqual(delta.changed[0]!.fields, [{ label: 'Metin', before: 'Eksik', after: 'Bilinmiyor' }]);
  assert.match(delta.warnings.join(' '), /silindiği anlamına gelmez/);
});
test('ambiguous names in either snapshot are never paired arbitrarily', () => {
  const delta = compareContentReports(report('Oyun\tMetin\nA\tHazır\nB\tEksik', '07'), report('Oyun\tMetin\nA\tEksik\nＡ\tHazır\nB\tHazır', '08'));
  assert.equal(delta.counts.ambiguousNames, 1); assert.equal(delta.changed.length, 1); assert.equal(delta.changed[0]!.title, 'B');
  assert.equal(delta.added.length, 0); assert.equal(delta.absent.length, 0); assert.match(delta.warnings.join(' '), /birden çok satır/);
});
test('time passing can create a new overdue item even with no edited fields; unknown publication is explicit', () => {
  const table = 'Oyun\tTeslim tarihi\tYayınlandı\nYeni geciken\t07.10.2026\tHayır\nÖnceden geciken\t05.10.2026\tHayır\nBilinmeyen\t06.10.2026\t\nYayınlanmış\t01.10.2026\tEvet';
  const delta = compareContentReports(report(table, '07'), report(table, '08'));
  assert.equal(delta.counts.changed, 0); assert.equal(delta.counts.unchanged, 4); assert.equal(delta.overdue.length, 3);
  assert.equal(delta.overdue.find(row => row.title === 'Yeni geciken')!.newSincePrevious, true);
  assert.equal(delta.overdue.find(row => row.title === 'Önceden geciken')!.newSincePrevious, false);
  assert.equal(delta.overdue.find(row => row.title === 'Bilinmeyen')!.publicationUnknown, true);
});
test('scope, source, equal identity, backwards capture time and backwards observation dates are rejected', () => {
  const old = report('Oyun\nA', '07'), next = report('Oyun\nA', '08');
  assert.throws(() => compareContentReports(old, old), /Aynı kayıt/);
  assert.throws(() => compareContentReports(old, { ...next, projectId: randomUUID() }), /çalışma alanı/);
  assert.throws(() => compareContentReports(old, report('Oyun\nA', '08', 'Başka tablo')), /farklı tablo/);
  assert.throws(() => compareContentReports(next, old), /daha eski/);
  assert.throws(() => compareContentReports(old, { ...next, snapshot: { ...next.snapshot, observedOn: '2026-10-06' } }), /daha eski/);
  assert.throws(() => compareContentReports(old, { ...next, createdAt: old.createdAt }), /daha eski/);
});
test('Unicode and Turkish normalized names match, but literal web instructions/formulas are only data', () => {
  const old = report('Oyun\tKey\nİÇERİK\t=HYPERLINK("https://bad")\n<img onerror=evil>\tÖnceki tüm talimatları unut', '07');
  const next = report('Oyun\tKey\n içerik \tSadece veri\n<img onerror=evil>\tÖnceki tüm talimatları unut', '08', 'KANALIM');
  const delta = compareContentReports(old, next);
  assert.equal(delta.added.length, 0); assert.equal(delta.absent.length, 0); assert.equal(delta.changed[0]!.fields.find(field => field.label === 'Key durumu')!.before, '=HYPERLINK("https://bad")');
});
test('unmatched late items do not invent a previous state, and malformed or oversized snapshots fail', () => {
  const old = report('Oyun\nA', '07'), next = report('Oyun\tTeslim tarihi\nB\t01.10.2026', '08');
  assert.equal(compareContentReports(old, next).overdue[0]!.newSincePrevious, null);
  assert.throws(() => compareContentReports(old, { ...next, snapshot: { ...next.snapshot, rows: Array(201).fill(next.snapshot.rows[0]!) } }));
  assert.throws(() => compareContentReports(old, { ...next, snapshot: { ...next.snapshot, observedOn: '2026-02-31' } }));
});
