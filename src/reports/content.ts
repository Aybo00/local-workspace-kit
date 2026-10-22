import { z } from 'zod';
import { AppError } from '../shared/types.js';
import { contentKeyWaiting, nextContentAction } from './content-actions.js';

export type Readiness = 'ready' | 'missing' | 'unknown';
export interface ContentRow {
  reference: string; title: string; deadline: string | null; release: string | null;
  published: boolean | null; keyStatus: string;
  stages: Record<'metin' | 'ses' | 'kurgu' | 'kapak', Readiness>;
}
export interface ContentSnapshot { sourceLabel: string; observedOn: string; importedAt: string; rows: ContentRow[]; warnings: string[] }
export interface ContentPriority { reference: string; title: string; reason: string[]; nextStep: string; deadline: string | null; release: string | null; tentative: boolean }
export interface ContentReport {
  generatedOn: string; sourceLabel: string; observedOn: string; sourceAgeDays: number;
  counts: { total: number; published: number; active: number; unknownPublication: number };
  priorities: ContentPriority[]; warnings: string[];
}
export interface ContentImport { projectId: string | null; sourceLabel: string; observedOn: string; table: string }
export interface SavedContentReport { id: string; projectId: string | null; createdAt: string; snapshot: ContentSnapshot; report: ContentReport }
export interface ContentReportSummary { id: string; projectId: string | null; createdAt: string; sourceLabel: string; generatedOn: string; observedOn: string; counts: ContentReport['counts'] }

const stageNames = { metin: 'Metin', ses: 'Ses', kurgu: 'Kurgu', kapak: 'Kapak' } as const;
type Column = 'title' | 'deadline' | 'release' | 'published' | 'key' | keyof typeof stageNames;
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/\s+/g, ' ');
const aliases: Record<Column, string[]> = {
  title: ['oyun', 'oyun adı', 'içerik', 'içerik adı'], deadline: ['teslim tarihi', 'son teslim', 'son teslim tarihi'], release: ['çıkış', 'çıkış tarihi'],
  published: ['yayınlandı', 'yayın durumu', 'yayınlandı mı'], key: ['key', 'key durumu'],
  metin: ['metin', 'metin durumu'], ses: ['ses', 'ses durumu'], kurgu: ['kurgu', 'kurgu durumu'], kapak: ['kapak', 'kapak durumu']
};
const headers = new Map(Object.entries(aliases).flatMap(([column, names]) => names.map(name => [name, column as Column] as const)));
const ready = new Set(['hazır', 'tamam', 'tamamlandı', 'var', 'evet', 'true', '1', '✅', '✓', '✔', 'yayınlandı']);
const missing = new Set(['eksik', 'yok', 'hayır', 'false', '0', '❌', 'bekliyor', 'yayınlanmadı']);
function readiness(raw: string): Readiness { const value = normalize(raw); return ready.has(value) ? 'ready' : missing.has(value) ? 'missing' : 'unknown'; }

// Civil dates, not elapsed local hours: DST and a midnight offset cannot change the count.
export function civilDay(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AppError('BAD_DATE', 'Tarih YYYY-AA-GG biçiminde olmalı.');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 2000 || year > 2999) throw new AppError('BAD_DATE', 'Tarih yılı geçerli değil.');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new AppError('BAD_DATE', 'Takvimde böyle bir tarih yok.');
  return date.getTime() / 86_400_000;
}
function parseDate(text: string, reference: string): string | null {
  const value = text.trim(); if (!value) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const date = match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  try { civilDay(date); return date; } catch { throw new AppError('BAD_DATE', `${reference}: tarih ${value} geçerli değil. DD.AA.YYYY veya YYYY-AA-GG kullan.`); }
}

// Google Sheets copy/paste TSV, including quoted tabs/newlines. No formulas or code execute.
function cells(text: string): string[][] {
  const table: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 30) throw new AppError('TABLE_LIMIT', 'En fazla otuz sütun okunur.'); };
  const pushRow = () => { pushCell(); if (row.some(value => value.trim())) table.push(row); row = []; if (table.length > 201) throw new AppError('TABLE_LIMIT', 'En fazla iki yüz içerik kaydı okunur.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += char;
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === '\t') pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i+1] === '\n') i++; pushRow(); }
    else { if (closed) throw new AppError('BAD_TABLE', 'Tırnaklı hücrenin sonu geçerli değil.'); cell += char; }
    if (cell.length > 1000) throw new AppError('TABLE_LIMIT', 'Bir hücre bin karakteri aşamaz.');
  }
  if (quoted) throw new AppError('BAD_TABLE', 'Tabloda kapanmamış tırnaklı hücre var.');
  if (cell || row.length || closed) pushRow(); return table;
}
export const contentImportSchema = z.object({ sourceLabel: z.string().trim().min(1).max(120), observedOn: z.string().length(10), table: z.string().min(1).max(64_000) }).strict();
export const savedContentImportSchema = contentImportSchema.extend({ projectId: z.string().uuid().nullable() }).strict();
const civilDateSchema = z.string().refine(value => { try { civilDay(value); return true; } catch { return false; } }, 'Geçerli bir takvim tarihi gerekli.');
const readinessSchema = z.enum(['ready', 'missing', 'unknown']);
export const contentSnapshotSchema = z.object({ sourceLabel: z.string().trim().min(1).max(120), observedOn: civilDateSchema, importedAt: z.iso.datetime(),
  rows: z.array(z.object({ reference: z.string().min(1).max(100), title: z.string().min(1).max(180), deadline: civilDateSchema.nullable(), release: civilDateSchema.nullable(), published: z.boolean().nullable(), keyStatus: z.string().max(200),
    stages: z.object({ metin: readinessSchema, ses: readinessSchema, kurgu: readinessSchema, kapak: readinessSchema }).strict() }).strict()).min(1).max(200),
  warnings: z.array(z.string().max(160)).max(35) }).strict();
export function importContent(raw: unknown, importedAt = new Date().toISOString()): ContentSnapshot {
  const input = contentImportSchema.parse(raw); civilDay(input.observedOn);
  if (!Number.isFinite(Date.parse(importedAt))) throw new AppError('BAD_DATE', 'Okuma zamanı geçerli değil.');
  const table = cells(input.table), header = table.shift();
  if (!header || !table.length) throw new AppError('BAD_TABLE', 'Başlık satırı ve en az bir içerik kaydı gerekli.');
  const columns = new Map<Column, number>(), warnings: string[] = [];
  header.forEach((name, index) => { const column = headers.get(normalize(name)); if (!column) { if (name.trim()) warnings.push(`Okunmayan sütun: ${name.trim().slice(0,80)}`); return; }
    if (columns.has(column)) throw new AppError('AMBIGUOUS_COLUMN', `Aynı alanı iki sütun temsil ediyor: ${name}.`); columns.set(column,index); });
  if (!columns.has('title')) throw new AppError('BAD_TABLE', 'Oyun veya İçerik adı sütunu bulunamadı.');
  const rows = table.map((data, index): ContentRow => {
    const reference = `Yapıştırılan tablo · veri satırı ${index+1}`;
    if (data.length !== header.length) throw new AppError('BAD_TABLE', `${reference}: sütun sayısı başlıkla aynı değil.`);
    const get = (key: Column) => columns.has(key) ? data[columns.get(key)!]!.trim() : '';
    const title = get('title'); if (!title || title.length > 180) throw new AppError('BAD_TABLE', `${reference}: içerik adı boş veya çok uzun.`);
    const publication = readiness(get('published'));
    const stages = Object.fromEntries(Object.keys(stageNames).map(key => [key, readiness(get(key as Column))])) as ContentRow['stages'];
    return { reference, title, deadline: parseDate(get('deadline'),reference), release: parseDate(get('release'),reference), published: publication === 'unknown' ? null : publication === 'ready', keyStatus: get('key').slice(0,200), stages };
  });
  if (!columns.has('published')) warnings.push('Yayın durumu sütunu yok; aktif/yayınlanmış sayımı kesinleştirilemez.');
  for (const [key,label] of Object.entries(stageNames)) if (!columns.has(key as Column)) warnings.push(`${label} sütunu yok; eksik olduğu varsayılmadı.`);
  return { sourceLabel: input.sourceLabel, observedOn: input.observedOn, importedAt, rows, warnings };
}

export function contentReport(snapshot: ContentSnapshot, asOf: string): ContentReport {
  const today = civilDay(asOf), age = today - civilDay(snapshot.observedOn), warnings = [...snapshot.warnings];
  if (age > 1) warnings.push(`Kaynak ${age} gün önceki veri; hesapla canlı bağlantı kurulmadı.`);
  if (age < 0) warnings.push('Kaynak tarihi gelecekte; verinin zamanını kontrol et.');
  if (!snapshot.rows.length || snapshot.rows.length > 200) throw new AppError('TABLE_LIMIT', 'Rapor kayıt sayısı geçerli değil.');
  const counts = { total: snapshot.rows.length, published: 0, active: 0, unknownPublication: 0 };
  const candidates: (ContentPriority & { score: number })[] = [];
  for (const row of snapshot.rows) {
    if (row.published === true) { counts.published++; continue; }
    if (row.published === false) counts.active++; else counts.unknownPublication++;
    const reasons: string[] = []; let score = 0;
    const left = row.deadline ? civilDay(row.deadline) - today : null;
    if (left !== null && left < 0) { reasons.push(`Teslim ${-left} gün geçmiş.`); score += 100 + Math.min(-left,30); }
    else if (left === 0) { reasons.push('Teslim bugün.'); score += 95; }
    else if (left !== null && left <= 7) { reasons.push(`Teslime ${left} gün var.`); score += 80 - left; }
    else if (left !== null) reasons.push(`Teslime ${left} gün var.`);
    else reasons.push('Teslim tarihi bilinmiyor.');
    if (row.release && civilDay(row.release) < today) { reasons.push('Çıkış tarihi geçmiş; teslim gecikmesiyle aynı durum değildir.'); score += 5; }
    const absent = Object.entries(row.stages).filter(([,state])=>state==='missing').map(([key])=>stageNames[key as keyof typeof stageNames]);
    const unknown = Object.entries(row.stages).filter(([,state])=>state==='unknown').map(([key])=>stageNames[key as keyof typeof stageNames]);
    if (absent.length) reasons.push(`Eksik: ${absent.join(', ')}.`);
    if (unknown.length) reasons.push(`Durumu bilinmeyen: ${unknown.join(', ')}.`);
    if (absent.length === 1 && !unknown.length) score += 15;
    const keyWaiting = contentKeyWaiting(row.keyStatus);
    if (keyWaiting) { reasons.push(`Key takibi: ${row.keyStatus}`); score += 10; }
    const nextStep = nextContentAction(row, age)!.instruction;
    if (row.published === null) reasons.push('Yayın durumu bilinmiyor; önce doğrula.');
    candidates.push({ reference: row.reference, title: row.title, reason: reasons, nextStep, deadline: row.deadline, release: row.release, tentative: row.published === null || age > 1 || age < 0, score });
  }
  candidates.sort((a,b)=>b.score-a.score || (a.deadline??'9999').localeCompare(b.deadline??'9999') || a.reference.localeCompare(b.reference));
  return { generatedOn: asOf, sourceLabel: snapshot.sourceLabel, observedOn: snapshot.observedOn, sourceAgeDays: age, counts, priorities:candidates.slice(0,3).map(({score,...item})=>item), warnings };
}
