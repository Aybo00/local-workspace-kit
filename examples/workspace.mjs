import { DraftEditor, ArchivePager } from '../dist/index.js';

// Demonstration adapter only: memory is not durable storage or encryption.
const records = new Map();
const editor = new DraftEditor({
  async draft(projectId) {
    return records.get(projectId) ?? {projectId,conversationId:null,text:'',revision:0,updatedAt:null};
  },
  async saveDraft(input) {
    const current = records.get(input.projectId);
    if ((current?.revision ?? 0) !== input.expectedRevision) throw Error('Revision conflict: explicit reload or retry required.');
    const saved = {projectId:input.projectId,conversationId:input.conversationId,text:input.text,revision:input.expectedRevision+1,updatedAt:new Date().toISOString()};
    records.set(input.projectId,saved); return saved;
  }
},{text:()=>{},locked:()=>{},state:()=>{}},60_000);
try {
  await editor.open('example-project');
  editor.edit('An unsent example draft',null);
  await editor.prepareClose();
  console.log('Acknowledged draft:', records.get('example-project').text);
} finally { editor.stop(); }

const pager = new ArchivePager(async ({projectId}) => ({items:[{id:'example',projectId}],nextCursor:null}),()=>{});
pager.replace('example-project');
await pager.newest();
console.log('Current page:',pager.items);
