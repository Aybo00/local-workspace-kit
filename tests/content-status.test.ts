import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentStatusRows } from '../src/reports/content-status.js';
import type { ContentRow, ContentSnapshot } from '../src/reports/content.js';

const row = (title: string, changes: Partial<ContentRow> = {}): ContentRow => ({ title, reference: title, deadline: '2026-10-08', release: null,
  published: false, keyStatus: '', stages: { metin: 'ready', ses: 'ready', kurgu: 'ready', kapak: 'ready' }, ...changes });
const snapshot = (rows: ContentRow[]): ContentSnapshot => ({ sourceLabel: 'Örnek', observedOn: '2026-10-08', importedAt: '2026-10-08T10:00:00Z', rows, warnings: [] });

test('status board uses every snapshot row even when the priority report only includes three', () => {
  const rows = contentStatusRows(snapshot(Array.from({ length: 200 }, (_, i) => row(String(i)))), '2026-10-08');
  assert.equal(rows.length, 200); assert.ok(rows.every(item => item.groups.includes('all')));
  assert.throws(() => contentStatusRows(snapshot(Array.from({ length: 201 }, (_, i) => row(String(i)))), '2026-10-08'), /iki yüz/);
});
test('published rows never appear as pending, overdue, missing or unverified work', () => {
  const [item] = contentStatusRows(snapshot([row('Bitti', { published: true, deadline: '2026-10-01', stages: { metin: 'unknown', ses: 'missing', kurgu: 'ready', kapak: 'ready' } })]), '2026-10-08');
  assert.deepEqual(item!.groups, ['all', 'published']);
});
test('deadline groups include today and day seven, exclude day eight and ignore release date', () => {
  const items = contentStatusRows(snapshot([
    row('Gecikmiş', { deadline: '2026-10-07' }), row('Bugün'), row('Yedi', { deadline: '2026-10-15' }),
    row('Sekiz', { deadline: '2026-10-16', release: '2026-01-01' }), row('Belirsiz', { deadline: null })
  ]), '2026-10-08');
  assert.deepEqual(items.filter(item => item.groups.includes('overdue')).map(item => item.row.title), ['Gecikmiş']);
  assert.deepEqual(items.filter(item => item.groups.includes('due-soon')).map(item => item.row.title), ['Bugün', 'Yedi']);
  assert.equal(items[4]!.daysToDeadline, null); assert.ok(items[4]!.groups.includes('needs-check'));
});
test('unknown publication and unknown stage require verification without inventing a missing stage', () => {
  const [unknown, missing] = contentStatusRows(snapshot([
    row('Bilinmeyen', { published: null, stages: { metin: 'unknown', ses: 'ready', kurgu: 'ready', kapak: 'ready' } }),
    row('Eksik', { stages: { metin: 'missing', ses: 'ready', kurgu: 'ready', kapak: 'ready' } })
  ]), '2026-10-08');
  assert.ok(unknown!.groups.includes('needs-check')); assert.ok(!unknown!.groups.includes('missing'));
  assert.ok(missing!.groups.includes('missing')); assert.ok(!missing!.groups.includes('needs-check'));
});
test('archived evaluation stays fixed, calendar validation and overlapping groups are explicit', () => {
  const value = snapshot([row('Ortak', { published: null, deadline: '2026-10-07', stages: { metin: 'missing', ses: 'ready', kurgu: 'ready', kapak: 'ready' } })]);
  const before = structuredClone(value); Object.freeze(value.rows[0]!.stages); Object.freeze(value.rows[0]); Object.freeze(value.rows); Object.freeze(value);
  const [item] = contentStatusRows(value, '2026-10-08');
  assert.deepEqual(item!.groups, ['all', 'overdue', 'missing', 'needs-check']); assert.equal(item!.daysToDeadline, -1);
  assert.deepEqual(value, before); assert.throws(() => contentStatusRows(value, '2026-02-30'), /Takvimde/);
  assert.throws(() => contentStatusRows(snapshot([row('Bozuk', { deadline: '2026-02-30' })]), '2026-10-08'), /Takvimde/);
});
