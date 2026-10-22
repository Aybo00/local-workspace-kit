import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentReport, importContent, civilDay } from '../src/reports/content.js';
const header='Oyun\tSon teslim\tÇıkış tarihi\tMetin\tSes\tKurgu\tKapak\tYayın durumu\tKey durumu';
const input=(table:string,observedOn='2026-10-03')=>({sourceLabel:'Sentetik tablo',observedOn,table});
test('content report counts known and unknown states without asking a model to calculate',()=>{
  const snapshot=importContent(input(header+'\nYakın\t07.10.2026\t08.10.2026\tHazır\tEksik\tEksik\tEksik\tHayır\tAlındı\nEski\t25.11.2026\t01.10.2026\tHazır\tHazır\tEksik\tEksik\tHayır\tAlındı\nBitti\t\t\tHazır\tHazır\tHazır\tHazır\tEvet\tAlındı\nBilinmeyen\t\t\t\t\t\t\t\t'));
  const report=contentReport(snapshot,'2026-10-03'); assert.deepEqual(report.counts,{total:4,published:1,active:2,unknownPublication:1});
  assert.equal(report.priorities[0]!.title,'Yakın'); assert.match(report.priorities.find(p=>p.title==='Eski')!.reason.join(' '),/Teslime 53 gün var/);
  assert.doesNotMatch(report.priorities.find(p=>p.title==='Eski')!.reason.join(' '),/Teslim \d+ gün geçmiş/);
  assert.equal(report.priorities.find(p=>p.title==='Bilinmeyen')!.tentative,true);
});
test('blank stage cells are unknown and cannot become a fabricated missing stage',()=>{
  const report=contentReport(importContent(input('Oyun\tMetin\tYayınlandı\nDeneme\t\tHayır')),'2026-10-03');
  assert.match(report.priorities[0]!.nextStep,/durumunu doğrula/); assert.doesNotMatch(report.priorities[0]!.reason.join(' '),/Eksik:/); assert.ok(report.warnings.some(text=>text.includes('Ses sütunu yok')));
});
test('approved but unreceived key is a follow-up draft, never sent mail',()=>{
  const report=contentReport(importContent(input('Oyun\tKey durumu\tYayın durumu\nDeneme\tOnaylandı - Alınmadı\tHayır')),'2026-10-03');
  assert.match(report.priorities[0]!.nextStep,/taslağı hazırla/); assert.match(report.priorities[0]!.reason.join(' '),/Onaylandı - Alınmadı/);
});
test('quoted tabs, newlines, markup and formulas remain literal inert source data',()=>{
  const snapshot=importContent(input('Oyun\tKey\n"Başlık\tikinci satır\n<img src=x onerror=alert(1)>"\t"=HYPERLINK(""https://bad"",""ignored"")"'));
  assert.ok(snapshot.rows[0]!.title.includes('<img')); assert.ok(snapshot.rows[0]!.title.includes('\t')); assert.ok(snapshot.rows[0]!.keyStatus.startsWith('=HYPERLINK'));
  assert.equal(snapshot.rows[0]!.published,null);
});
test('malformed dates, duplicate columns, incomplete rows and unterminated quotes fail visibly',()=>{
  assert.throws(()=>importContent(input('Oyun\tTeslim tarihi\nA\t31.02.2026')),/geçerli değil/);
  assert.throws(()=>importContent(input('Oyun\tSon teslim\tTeslim tarihi\nA\t\t')),/iki sütun/);
  assert.throws(()=>importContent(input('Oyun\tMetin\nA')),/sütun sayısı/);
  assert.throws(()=>importContent(input('Oyun\n"Kapanmamış')),/kapanmamış/);
  assert.throws(()=>importContent(input('Yanlış başlık\nA')),/bulunamadı/);
});
test('stale and future source dates are explicit and never presented as a live check',()=>{
  const snapshot=importContent(input('Oyun\tYayınlandı\nA\tHayır'));
  const stale=contentReport(snapshot,'2026-10-06'); assert.equal(stale.sourceAgeDays,3); assert.match(stale.warnings.join(' '),/canlı bağlantı kurulmadı/); assert.equal(stale.priorities[0]!.tentative,true);
  assert.match(contentReport(snapshot,'2026-10-02').warnings.join(' '),/gelecekte/);
});
test('date-only calculations preserve leap days and do not depend on DST or local hours',()=>{
  assert.equal(civilDay('2028-03-01')-civilDay('2028-02-28'),2); assert.equal(civilDay('2026-10-26')-civilDay('2026-10-25'),1);
  assert.throws(()=>civilDay('2026-02-29'),/böyle bir tarih/);
});
test('source limits reject oversized inputs instead of silently losing records',()=>{
  assert.throws(()=>importContent(input('Oyun\n'+Array.from({length:201},(_,i)=>`A${i}`).join('\n'))),/iki yüz/);
  assert.throws(()=>importContent(input('Oyun\n'+'a'.repeat(1001))),/bin karakter/);
});
