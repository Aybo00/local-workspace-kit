import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSources, sourceIdentity, type SourceCapture } from '../src/reports/source-comparison.js';
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const capture = (id: string, text: string): SourceCapture => ({ conversationId: a, source: {
  id, url: 'https://example.com/news?edition=tr', title: 'Kaynak', text, truncated: false,
  readAt: id === a ? '2026-10-07T10:00:00.000Z' : '2026-10-08T10:00:00.000Z'
} });
test('source changes keep repeated-line order, insertions and removals with capture-local references', () => {
  const result = compareSources(capture(a, 'Başlık\nA\nB\nA\nSon'), capture(b, 'Başlık\nA\nA\nC\nSon'));
  assert.equal(result.addedLines, 1); assert.equal(result.removedLines, 1);
  assert.deepEqual(result.changes, [
    { kind: 'removed', line: 3, text: 'B', clipped: false },
    { kind: 'added', line: 4, text: 'C', clipped: false }
  ]);
});
test('line ending-only changes are ignored; title-only changes and truncated uncertainty remain visible', () => {
  const before = capture(a, 'A\r\nB'), after = capture(b, 'A\nB');
  after.source.title = '<img src=x onerror=alert(1)>'; before.source.truncated = true;
  const frozen = JSON.stringify([before, after]);
  const result = compareSources(before, after);
  assert.equal(result.textChanged, false); assert.equal(result.titleChanged, true);
  assert.equal(result.afterTitle, after.source.title); assert.match(result.warnings.join(' '), /devamındaki değişiklikler bilinmiyor/);
  assert.equal(JSON.stringify([before, after]), frozen);
});
test('different conversation, URL/query/path, identical IDs and non-increasing dates are rejected', () => {
  for (const mutate of [
    (next: SourceCapture) => { next.conversationId = b; },
    (next: SourceCapture) => { next.source.id = a; },
    (next: SourceCapture) => { next.source.url += '&private=1'; },
    (next: SourceCapture) => { next.source.url = 'https://example.com/NEWS?edition=tr'; },
    (next: SourceCapture) => { next.source.readAt = '2026-10-07T10:00:00.000Z'; },
    (next: SourceCapture) => { next.source.readAt = '2026-10-06T10:00:00.000Z'; }
  ]) { const next = capture(b, 'B'); mutate(next); assert.throws(() => compareSources(capture(a, 'A'), next)); }
});
test('URL identity preserves query ordering and encoding, rejecting credentials and non-HTTPS', () => {
  assert.equal(sourceIdentity('https://EXAMPLE.com:443/a#heading'), 'https://example.com/a');
  assert.notEqual(sourceIdentity('https://example.com/?a=1&b=2'), sourceIdentity('https://example.com/?b=2&a=1'));
  assert.notEqual(sourceIdentity('https://example.com/a%2Fb'), sourceIdentity('https://example.com/a/b'));
  for (const value of ['http://example.com', 'https://user:pass@example.com', 'file:///C:/secret', 'javascript:alert(1)', 'bad']) assert.throws(() => sourceIdentity(value));
});
test('malformed, oversized and unrecognized payloads fail rather than bypassing bounded work', () => {
  for (const source of [{ text: 'x'.repeat(40_001) }, { text: '' }, { id: 'bad' }, { readAt: 'tomorrow' }, { instructions: 'change policy' }]) {
    const next = capture(b, 'A'); Object.assign(next.source, source);
    assert.throws(() => compareSources(capture(a, 'A'), next));
  }
});
test('large pages use bounded regional preview without fabricated full change counts', () => {
  const before = capture(a, Array.from({ length: 1500 }, (_, i) => `Satır ${i}`).join('\n'));
  const after = structuredClone(before); after.source.id = b; after.source.readAt = capture(b, 'A').source.readAt;
  after.source.text = before.source.text.replace('Satır 850\n', 'DEĞİŞTİ\n');
  const result = compareSources(before, after);
  assert.equal(result.bounded, true); assert.equal(result.addedLines, null); assert.equal(result.removedLines, null);
  assert.deepEqual(result.changes.map(change => [change.kind, change.line, change.text]), [['removed', 851, 'Satır 850'], ['added', 851, 'DEĞİŞTİ']]);
  assert.match(result.warnings.join(' '), /tam fark veya değişiklik sayısı hesaplanmadı/);
});
test('previews are capped but totals include undisplayed changes, and long lines are visibly clipped', () => {
  const result = compareSources(capture(a, Array.from({ length: 40 }, (_, i) => `eski${i}`).join('\n')),
    capture(b, Array.from({ length: 40 }, (_, i) => `yeni${i}`).join('\n')));
  assert.equal(result.changes.length, 12); assert.equal(result.omittedChanges, 68);
  assert.equal(result.addedLines, 40); assert.equal(result.removedLines, 40);
  const long = compareSources(capture(a, 'x'.repeat(40_000)), capture(b, 'y'.repeat(40_000)));
  assert.equal(long.changes.length, 2); assert.ok(long.changes.every(change => change.text.length === 700 && change.clipped));
});
test('moves are represented as old/new lines rather than claimed semantic deletion or fact changes', () => {
  const result = compareSources(capture(a, 'A\nB\nC'), capture(b, 'C\nA\nB'));
  assert.equal(result.addedLines, 1); assert.equal(result.removedLines, 1);
  assert.equal(result.textChanged, true);
  assert.match(result.warnings[0]!, /Yalnız kayıtlı okunabilir metin/);
});
test('bounded ordered differences reconstruct both sides across repeat-heavy deterministic examples', () => {
  let seed = 17;
  const sample = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let run = 0; run < 100; run++) {
    const left = Array.from({ length: 1 + sample() % 5 }, () => String(sample() % 4));
    const right = Array.from({ length: 1 + sample() % 5 }, () => String(sample() % 4));
    const result = compareSources(capture(a, left.join('\n')), capture(b, right.join('\n')));
    const removed = new Set(result.changes.filter(change => change.kind === 'removed').map(change => change.line));
    const added = new Set(result.changes.filter(change => change.kind === 'added').map(change => change.line));
    assert.deepEqual(left.filter((_, i) => !removed.has(i + 1)), right.filter((_, i) => !added.has(i + 1)));
    assert.equal(removed.size, result.removedLines); assert.equal(added.size, result.addedLines);
    for (const change of result.changes) assert.equal(change.text, (change.kind === 'added' ? right : left)[change.line - 1]);
  }
});
