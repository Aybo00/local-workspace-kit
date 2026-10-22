#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { importContent, contentReport, contentReportText, contentWorkplan,
  contentWorkplanText, compareSources, compareContentReports } from '../dist/index.js';

const help = `local-workspace: deterministic, offline report utilities

  plan FILE.tsv --observed-on YYYY-MM-DD --as-of YYYY-MM-DD [--label NAME] [--text]
  report FILE.tsv --observed-on YYYY-MM-DD --as-of YYYY-MM-DD [--label NAME] [--text]
  source-diff FILE.json            JSON object: {before: SourceCapture, after: SourceCapture}
  content-diff FILE.json           JSON object: {before: SavedContentReport, after: SavedContentReport}

Reads only the named file (maximum 128 KB). Writes the result to stdout.
No URLs are fetched; no AI model, credentials, database or scheduler is used.
Turkish table headers and report text are supported in this initial release.
`;

export async function readBoundedFile(file) {
  const handle = await open(file,'r');
  try {
    if (!(await handle.stat()).isFile()) throw Error('Input must be a regular file.');
    const buffer = Buffer.alloc(128_001);
    let used = 0;
    while (used < buffer.length) {
      const {bytesRead} = await handle.read(buffer,used,buffer.length-used,null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 128_000) throw Error('Input exceeds 128 KB.');
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));
  } finally {await handle.close();}
}

try {
  const {values,positionals} = parseArgs({allowPositionals:true,strict:true,options:{
    'observed-on':{type:'string'},'as-of':{type:'string'},label:{type:'string'},text:{type:'boolean'},help:{type:'boolean'}
  }});
  if (values.help || !positionals.length) console.log(help);
  else {
    const [command,file,...rest] = positionals;
    if (!file || rest.length || !['plan','report','source-diff','content-diff'].includes(command)) throw Error('Invalid command. Use --help.');
    const input = await readBoundedFile(file);
    let result;
    if (command === 'plan' || command === 'report') {
      if (!values['observed-on'] || !values['as-of']) throw Error('--observed-on and --as-of are required.');
      const snapshot = importContent({sourceLabel:values.label || 'Local input',observedOn:values['observed-on'],table:input});
      const date = values['as-of'];
      if (command === 'plan') result = values.text ? contentWorkplanText(snapshot,date) : contentWorkplan(snapshot,date);
      else {
        const report = contentReport(snapshot,date);
        result = values.text ? contentReportText({id:'00000000-0000-4000-8000-000000000001',projectId:null,createdAt:snapshot.importedAt,snapshot,report},true) : report;
      }
    } else {
      if (values.text || values.label || values['as-of'] || values['observed-on']) throw Error('Diff commands accept only a JSON file.');
      let pair;
      try { pair = JSON.parse(input); } catch { throw Error('Invalid JSON input.'); }
      if (!pair || typeof pair !== 'object' || Array.isArray(pair) || Object.keys(pair).sort().join(',') !== 'after,before') throw Error('Expected exactly before and after.');
      result = command === 'source-diff' ? compareSources(pair.before,pair.after) : compareContentReports(pair.before,pair.after);
    }
    process.stdout.write((typeof result === 'string' ? result : JSON.stringify(result,null,2))+'\n');
  }
} catch (error) {
  // Do not echo JSON parser excerpts or schema input details into diagnostics.
  const message = error?.name === 'ZodError' ? 'Input does not match the documented schema.' : error instanceof Error ? error.message : 'Operation failed.';
  process.stderr.write('local-workspace: '+message+'\n');
  process.exitCode = 1;
}
