import type { ContentRow } from './content.js';

export const productionStages = [
  { id: 'metin', label: 'Metin' }, { id: 'ses', label: 'Ses' },
  { id: 'kurgu', label: 'Kurgu' }, { id: 'kapak', label: 'Kapak' }
] as const;
export type ProductionStage = typeof productionStages[number]['id'];
export interface ContentAction {
  kind: 'verify-publication' | 'verify-key' | 'verify-stage' | 'complete-stage' | 'verify-delivery' | 'refresh-source';
  stage: ProductionStage | null;
  instruction: string;
}

// Suggestions only, never tool calls or permission. An unknown publication
// must not create duplicate production work. The stage order is fixed, not
// dependent on object property order or instructions in a table cell.
export const contentKeyWaiting = (status: string) => /alınmadı|istendi|bekliyor/.test(status.normalize('NFKC').toLocaleLowerCase('tr-TR').trim().replace(/\s+/g, ' '));

export function nextContentAction(row: ContentRow, sourceAgeDays = 0): ContentAction | null {
  if (row.published === true) return null;
  if (sourceAgeDays < 0 || sourceAgeDays > 1) return { kind: 'refresh-source', stage: null,
    instruction: sourceAgeDays < 0 ? 'Önce tablonun veri tarihini doğrula; gelecekteki kayıtla üretim kararı verme.'
      : 'Önce tablonun son halini doğrula; eski kayıttaki üretim işini otomatik olarak yeniden başlatma.' };
  if (row.published === null) return { kind: 'verify-publication', stage: null,
    instruction: 'Önce yayın durumunu doğrula; yayınlanmış bir içerik için aynı üretim işini yeniden başlatma.' };
  if (contentKeyWaiting(row.keyStatus)) return { kind: 'verify-key', stage: null,
    instruction: 'Key durumunu kontrol et; gerekirse takip mesajı taslağı hazırla.' };
  const first = productionStages.find(stage => row.stages[stage.id] !== 'ready');
  if (!first) return { kind: 'verify-delivery', stage: null,
    instruction: 'Kayıtta üretim adımları hazır; yayın ve teslim durumunu kontrol et. Bu öneri yayınlama işlemi yapmaz.' };
  const unknown = row.stages[first.id] === 'unknown';
  return { kind: unknown ? 'verify-stage' : 'complete-stage', stage: first.id,
    instruction: unknown ? `${first.label} durumunu doğrula; boş hücreyi eksik yapılmış iş sayma.` : `${first.label} adımını tamamla; sonraki aşamaya geçmeden kayıttaki durumu kontrol et.` };
}
