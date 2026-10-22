import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
await mkdir(path.join(root,'dist'),{recursive:true});
await build({entryPoints:[path.join(root,'src/index.ts')],outfile:path.join(root,'dist/index.js'),
  bundle:true,format:'esm',platform:'neutral',target:'es2023',external:['zod'],sourcemap:false,legalComments:'inline'});
execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--project',path.join(root,'tsconfig.json')],{cwd:root,stdio:'inherit'});
console.log('Library and TypeScript declarations built. No model, network or application launch.');
