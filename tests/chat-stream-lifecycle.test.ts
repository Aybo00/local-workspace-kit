import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatTextStream } from '../src/core/chat-text-stream.js';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('a provider cannot finish while its text delivery is still pending', { timeout: 1500 }, async () => {
  const stalled = deferred(), entered = deferred(), job = new AbortController(), phase = new AbortController();
  const stream = new ChatTextStream(async event => { if (event.type === 'text') { entered.resolve(); await stalled.promise; } }, job.signal);
  const generation = await stream.begin(phase.signal, 'Fixture');
  const pending = generation.text('A').catch(() => {});
  try {
    await entered.promise;
    assert.throws(() => generation.finish({ content: 'A', toolCalls: [] }, true));
  } finally { generation.close(); stream.close(); stalled.resolve(); await pending; }
});

test('closing a generation cancels its consumer signal and settles delivery without cancelling the job', { timeout: 1500 }, async () => {
  for (const closeJobStream of [false, true]) {
    const stalled = deferred(), entered = deferred(), job = new AbortController(), phase = new AbortController();
    let consumerSignal!: AbortSignal, settled = false;
    const stream = new ChatTextStream(async (event, signal) => {
      if (event.type === 'text') { consumerSignal = signal; entered.resolve(); await stalled.promise; }
    }, job.signal);
    const generation = await stream.begin(phase.signal, 'Fixture');
    const pending = generation.text('A').then(() => { settled = true; }, () => { settled = true; });
    try {
      await entered.promise; if (closeJobStream) stream.close(); else generation.close(); await tick();
      assert.equal(consumerSignal.aborted, true); assert.equal(settled, true);
      assert.equal(phase.signal.aborted, false); assert.equal(job.signal.aborted, false);
    } finally { generation.close(); stream.close(); stalled.resolve(); await pending; }
  }
});
