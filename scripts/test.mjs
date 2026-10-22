import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(name => /\.test\.(ts|mjs)$/.test(name)).sort().map(name => `tests/${name}`);
if (!files.length) throw Error('No tests found.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
  cwd: root, stdio: 'inherit', windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
