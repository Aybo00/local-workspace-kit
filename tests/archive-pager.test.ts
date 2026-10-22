import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchivePager } from '../src/renderer/archive-pager.js';
import type { ArchivePage, ArchivePageInput } from '../src/shared/types.js';

type Item = { id: string };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const first: ArchivePage<Item> = { items: [{ id: 'new' }], nextCursor: 'new' };
const second: ArchivePage<Item> = { items: [{ id: 'old' }], nextCursor: null };

test('archive navigation replaces one page, coalesces clicks and returns to the newest page', async () => {
  const waiting = deferred<ArchivePage<Item>>(), calls: ArchivePageInput[] = [];
  const pager = new ArchivePager<Item>(input => { calls.push(input); return input.beforeId ? waiting.promise : Promise.resolve(first); }, () => {});
  pager.replace('scope-a', first);
  const older = pager.older(); await pager.older();
  assert.equal(pager.isLoading, true); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { projectId: 'scope-a', beforeId: 'new' });
  waiting.resolve(second); await older;
  assert.deepEqual(pager.items, second.items); assert.equal(pager.isOlderPage, true); assert.equal(pager.isLoading, false);
  await pager.older(); assert.equal(calls.length, 1);
  await pager.newest(); assert.deepEqual(pager.items, first.items); assert.equal(pager.isOlderPage, false);
  assert.deepEqual(calls[1], { projectId: 'scope-a' });
});

test('a late old-scope page cannot restore private records after changing scope', async () => {
  const waiting = deferred<ArchivePage<Item>>(); let changes = 0;
  const pager = new ArchivePager<Item>(() => waiting.promise, () => { changes++; });
  pager.replace('scope-a', first); const older = pager.older();
  pager.replace('scope-b', { items: [{ id: 'only-b' }], nextCursor: null }); const afterSwitch = changes;
  waiting.resolve({ items: [{ id: 'private-a' }], nextCursor: 'private-a' }); await older;
  assert.equal(pager.scope, 'scope-b'); assert.deepEqual(pager.items, [{ id: 'only-b' }]);
  assert.equal(pager.isLoading, false); assert.equal(changes, afterSwitch);
});

test('same-scope refresh invalidates in-flight pages and obsolete errors are ignored', async () => {
  const waiting = deferred<ArchivePage<Item>>(), pager = new ArchivePager<Item>(() => waiting.promise, () => {});
  pager.replace(null, first); const older = pager.older();
  pager.replace(null, { items: [{ id: 'fresh' }], nextCursor: null });
  waiting.reject(new Error('stale private request')); await older;
  assert.deepEqual(pager.items, [{ id: 'fresh' }]); assert.equal(pager.isOlderPage, false);
});

test('a current request error retains its page and permits an explicit retry', async () => {
  let calls = 0;
  const pager = new ArchivePager<Item>(async () => { if (++calls === 1) throw new Error('try again'); return second; }, () => {});
  pager.replace(null, first); await assert.rejects(pager.older(), /try again/);
  assert.deepEqual(pager.items, first.items); assert.equal(pager.nextCursor, 'new'); assert.equal(pager.isLoading, false);
  await pager.older(); assert.deepEqual(pager.items, second.items); assert.equal(calls, 2);
});

test('a post-write refresh supersedes an old page without accepting its late result', async () => {
  const old = deferred<ArchivePage<Item>>(), fresh = deferred<ArchivePage<Item>>(), calls: ArchivePageInput[] = [];
  const pager = new ArchivePager<Item>(input => { calls.push(input); return input.beforeId ? old.promise : fresh.promise; }, () => {});
  pager.replace('scope', first); const obsolete = pager.older(), refresh = pager.refreshNewest();
  old.resolve(second); await obsolete; assert.equal(pager.isLoading, true); assert.deepEqual(pager.items, first.items);
  fresh.resolve({ items: [{ id: 'saved-report' }], nextCursor: 'saved-report' }); await refresh;
  assert.deepEqual(calls, [{ projectId: 'scope', beforeId: 'new' }, { projectId: 'scope' }]);
  assert.deepEqual(pager.items, [{ id: 'saved-report' }]); assert.equal(pager.isOlderPage, false); assert.equal(pager.isLoading, false);
});

test('post-write page failure preserves the visible archive and later scope change hides late private results', async () => {
  const fresh = deferred<ArchivePage<Item>>(); let calls = 0;
  const pager = new ArchivePager<Item>(async () => { if (++calls === 1) throw Error('page unavailable'); return fresh.promise; }, () => {});
  pager.replace('private', first); await assert.rejects(pager.refreshNewest(), /page unavailable/);
  assert.deepEqual(pager.items, first.items); assert.equal(pager.isLoading, false);
  const pending = pager.refreshNewest(); pager.replace('other'); fresh.resolve(second); await pending;
  assert.deepEqual(pager.items, []); assert.equal(pager.scope, 'other'); assert.equal(pager.isLoading, false);
});
