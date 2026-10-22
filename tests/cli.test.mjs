import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/local-workspace.mjs'), ...args], {
  cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true
});
async function input(t, content) {
  const dir = await mkdtemp(path.join(tmpdir(), 'local-workspace-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture.txt'); await writeFile(file, content); return file;
}

test('the built CLI prints help and produces a structured report from the supplied TSV', () => {
  assert.equal(run('--help').status, 0);
  const result = run('report', 'examples/content.tsv', '--observed-on', '2026-10-08', '--as-of', '2026-10-08');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).counts, { total: 4, published: 1, active: 2, unknownPublication: 1 });
});

test('the built CLI runs the supplied source comparison without fetching the URL', () => {
  const result = run('source-diff', 'examples/source-diff.json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.ok(report);
  assert.match(result.stdout, /example\.com/);
});

test('CLI validation rejects an oversized file and invalid UTF-8', async t => {
  for (const content of ['x'.repeat(128_001), Buffer.from([0xff, 0xfe, 0xfd])]) {
    const file = await input(t, content), result = run('source-diff', file);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
  }
});

test('malformed JSON and schemas fail without echoing the supplied private-looking contents', async t => {
  const marker = 'SYNTHETIC-DO-NOT-ECHO-4938';
  for (const content of [`{"before":"${marker}",broken}`, JSON.stringify({ before: { [marker]: marker }, after: {} })]) {
    const file = await input(t, content), result = run('source-diff', file);
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes(marker));
  }
});

test('the CLI rejects extra files, missing dates and incompatible diff flags', () => {
  for (const args of [
    ['report', 'examples/content.tsv'],
    ['source-diff', 'examples/source-diff.json', '--text'],
    ['source-diff', 'examples/source-diff.json', 'another-file.json']
  ]) assert.equal(run(...args).status, 1);
});
