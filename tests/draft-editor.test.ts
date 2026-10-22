import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftEditor } from '../src/renderer/draft-editor.js';
import type { ComposerDraft, DraftSaveInput } from '../src/shared/types.js';

const empty = (projectId: string | null = null): ComposerDraft => ({ projectId, conversationId: null, text: '', revision: 0, updatedAt: null });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(save?: (input: DraftSaveInput) => Promise<ComposerDraft>) {
  const state = { text: '', locked: true, message: '', failed: false }, writes: DraftSaveInput[] = [];
  const records = new Map<string | null, ComposerDraft>();
  const api = { draft: async (id: string | null) => records.get(id) ?? empty(id), saveDraft: async (input: DraftSaveInput) => {
    writes.push(input);
    const saved = save ? await save(input) : { projectId: input.projectId, conversationId: input.conversationId, text: input.text, revision: input.expectedRevision + 1, updatedAt: '2026-10-06T00:00:00Z' };
    records.set(input.projectId, saved); return saved;
  } };
  const editor = new DraftEditor(api, { text: value => { state.text = value; }, locked: value => { state.locked = value; }, state: (message, failed) => { state.message = message; state.failed = failed; } }, 60_000);
  return { state, records, writes, api, editor };
}

test('late save ACK cannot replace newer typing; only one write runs and latest edit is coalesced', async t => {
  const first = deferred<ComposerDraft>(); let calls = 0;
  const f = fixture(async input => ++calls === 1 ? first.promise : { ...empty(input.projectId), text: input.text, conversationId: input.conversationId, revision: input.expectedRevision + 1 });
  t.after(() => f.editor.stop()); await f.editor.open(null);
  f.editor.edit('Old text', null); const pending = f.editor.flush(); assert.equal(f.editor.flush(), pending); await tick();
  f.editor.edit('Newest text', null); first.resolve({ ...empty(), text: 'Old text', revision: 1 }); await pending;
  assert.deepEqual(f.writes.map(row => [row.text, row.expectedRevision]), [['Old text', 0], ['Newest text', 1]]);
  assert.equal(f.editor.dirty, false); assert.equal(f.records.get(null)!.text, 'Newest text');
});

test('save failure preserves the draft, blocks sending/switching and requires explicit retry', async t => {
  let fail = true; const f = fixture(async input => { if (fail) throw new Error('Synthetic write failure'); return { ...empty(), text: input.text, revision: input.expectedRevision + 1 }; });
  t.after(() => f.editor.stop()); await f.editor.open(null); f.editor.edit('Keep unsent', null);
  await assert.rejects(f.editor.flush()); assert.equal(f.editor.dirty, true); assert.equal(f.state.failed, true);
  await assert.rejects(f.editor.open('project-b')); assert.equal(f.state.locked, true); assert.equal(f.state.text, '');
  fail = false; await f.editor.retry(); assert.equal(f.records.get(null)!.text, 'Keep unsent');
  await f.editor.open('project-b'); assert.equal(f.state.text, ''); assert.equal(f.state.locked, false);
});

test('successful reply clears only its unchanged draft, never text typed while the task was running', async t => {
  const f = fixture(); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.editor.edit('Original', null); await f.editor.flush(); f.editor.edit('Next question', null);
  await f.editor.clearSent('Original'); await f.editor.flush(); assert.equal(f.records.get(null)!.text, 'Next question');
  await f.editor.clearSent('Next question'); assert.equal(f.records.get(null)!.text, ''); assert.equal(f.editor.dirty, false);
});

test('switching workspaces flushes the old scope and restores only the selected private draft', async t => {
  const f = fixture(); t.after(() => f.editor.stop()); f.records.set('b', { ...empty('b'), text: 'Private B', revision: 4 });
  await f.editor.open(null); f.editor.edit('General draft', null); await f.editor.open('b');
  assert.equal(f.records.get(null)!.text, 'General draft'); assert.equal(f.state.text, 'Private B');
  f.editor.target('conversation-b'); await f.editor.flush(); assert.equal(f.records.get('b')!.conversationId, 'conversation-b');
  await f.editor.open(null); assert.equal(f.state.text, 'General draft');
});

test('a stale scope read cannot expose another project after a newer choice', async t => {
  const slow = deferred<ComposerDraft>(), f = fixture(); t.after(() => f.editor.stop());
  f.api.draft = async id => id === 'a' ? slow.promise : { ...empty(id), text: 'Chosen B' };
  const old = f.editor.open('a'); const current = f.editor.open('b'); await current;
  slow.resolve({ ...empty('a'), text: 'Stale private A' }); await old;
  assert.equal(f.state.text, 'Chosen B'); assert.equal(f.state.locked, false);
});

test('failed post-reply clearing restores the acknowledged original as editable text', async t => {
  const f = fixture(async input => { if (!input.text) throw new Error('Synthetic clear failure');
    return { ...empty(), text: input.text, revision: input.expectedRevision + 1 }; });
  t.after(() => f.editor.stop()); await f.editor.open(null); f.editor.edit('Original prompt', null); await f.editor.flush();
  await assert.rejects(f.editor.clearSent('Original prompt'));
  assert.equal(f.state.text, 'Original prompt'); assert.equal(f.records.get(null)!.text, 'Original prompt');
  assert.equal(f.state.failed, true);
});

test('a delayed explicit reload cannot replace a newer workspace choice', async t => {
  const slow = deferred<ComposerDraft>(), f = fixture(); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.api.draft = async id => id === null ? slow.promise : { ...empty(id), text: 'Chosen private B' };
  const previous = f.editor.reload(null); const next = f.editor.open('b'); await next;
  slow.resolve({ ...empty(), text: 'Obsolete general text' }); await previous;
  assert.equal(f.state.text, 'Chosen private B'); assert.equal(f.state.locked, false);
});

test('graceful close freezes latest typing, waits for pending ACK, and cannot erase it after a late reply', async t => {
  const ack = deferred<ComposerDraft>(), f = fixture(() => ack.promise); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.editor.edit('Last keystroke', null); const closed = f.editor.prepareClose(); await tick();
  assert.equal(f.state.locked, true); assert.equal(f.writes.length, 1);
  f.editor.edit('Too late', null); let done = false; void closed.then(() => { done = true; }); await tick(); assert.equal(done, false);
  ack.resolve({ ...empty(), text: 'Last keystroke', revision: 1 }); await closed;
  await f.editor.clearSent('Last keystroke'); assert.equal(f.records.get(null)!.text, 'Last keystroke');
  await assert.rejects(f.editor.open('different scope')); assert.equal(f.editor.unsettled, false);
});

test('failed close save preserves the document and requires explicit retry before a later close can ACK', async t => {
  let fail = true; const f = fixture(async input => { if (fail) throw new Error('Disk fixture failure'); return { ...empty(), text: input.text, revision: 1 }; });
  t.after(() => f.editor.stop()); await f.editor.open(null); f.editor.edit('Keep during close', null);
  await assert.rejects(f.editor.prepareClose()); assert.equal(f.editor.dirty, true); assert.equal(f.state.locked, true);
  fail = false; await f.editor.retry(); await f.editor.prepareClose(); assert.equal(f.records.get(null)!.text, 'Keep during close');
});

test('a failed reload after close begins cannot unlock typing that the editor would ignore', async t => {
  const read = deferred<ComposerDraft>(), f = fixture(); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.editor.edit('Keep during delayed reload', null);
  f.api.draft = async () => read.promise;
  const reload = assert.rejects(f.editor.reload(null), /Synthetic read failure/); await tick();
  await assert.rejects(f.editor.prepareClose(), /hâlâ değişiyor/); assert.equal(f.state.locked, true);
  read.reject(new Error('Synthetic read failure')); await reload;
  assert.equal(f.state.locked, true, 'closing document must never become editable after a failed read');
  f.editor.edit('Ignored after close', null); await f.editor.prepareClose();
  assert.equal(f.records.get(null)!.text, 'Keep during delayed reload');
});

test('failed reload outside close keeps the same scope editable but does not expose a different scope', async t => {
  const f = fixture(); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.api.draft = async () => { throw new Error('Synthetic read failure'); };
  await assert.rejects(f.editor.reload(null)); assert.equal(f.state.locked, false);
  f.editor.edit('Still editable', null); await f.editor.flush(); assert.equal(f.records.get(null)!.text, 'Still editable');
  await assert.rejects(f.editor.reload('other')); assert.equal(f.state.locked, true);
});

test('a storage read for the wrong workspace is rejected before its text reaches the view', async t => {
  const f = fixture(); t.after(() => f.editor.stop());
  f.api.draft = async () => ({ ...empty('wrong'), text: 'Do not display this scope' });
  await assert.rejects(f.editor.open('requested'), /alanı veya biçimi/);
  assert.equal(f.state.text, ''); assert.equal(f.state.locked, true);
});

test('a mismatched save ACK cannot mark unsent edits as saved or cause a retry loop', async t => {
  for (const wrong of [
    { projectId: 'other' }, { text: 'Different saved text' },
    { conversationId: 'other-conversation' }, { revision: 0 }, { revision: 2 }
  ]) {
    const f = fixture(async input => ({ ...empty(input.projectId), text: input.text, revision: 1, ...wrong }));
    t.after(() => f.editor.stop()); await f.editor.open(null); f.editor.edit('Preserve local draft', null);
    await assert.rejects(f.editor.flush()); assert.equal(f.editor.dirty, true);
    assert.equal(f.state.failed, true); assert.equal(f.writes.length, 1);
    await assert.rejects(f.editor.flush()); assert.equal(f.writes.length, 1);
  }
});

test('invalid reload records preserve local text and a saturated revision never reaches the writer', async t => {
  const f = fixture(); t.after(() => f.editor.stop()); await f.editor.open(null);
  f.editor.edit('Keep this local edit', null);
  f.api.draft = async () => ({ ...empty(), revision: -1 });
  await assert.rejects(f.editor.reload(null));
  await f.editor.flush(); assert.equal(f.writes[0]!.text, 'Keep this local edit');
  f.api.draft = async () => ({ ...empty(), revision: Number.MAX_SAFE_INTEGER });
  await f.editor.reload(null); f.editor.edit('Cannot increment safely', null);
  const previous = f.writes.length; await assert.rejects(f.editor.flush(), /revizyon sınırına/);
  assert.equal(f.writes.length, previous); assert.equal(f.editor.dirty, true);
});
