import { AppError } from '../shared/types.js';
import { civilDay, type ContentRow, type ContentSnapshot } from './content.js';

export const contentStatusGroups = [
  { id: 'all', label: 'Tümü' },
  { id: 'overdue', label: 'Teslimi geciken' },
  { id: 'due-soon', label: 'Teslimi 7 gün içinde' },
  { id: 'missing', label: 'Üretimi eksik' },
  { id: 'needs-check', label: 'Bilgisi doğrulanacak' },
  { id: 'published', label: 'Yayınlanmış' }
] as const;
export type ContentStatusGroup = typeof contentStatusGroups[number]['id'];
export interface ContentStatusRow { row: ContentRow; daysToDeadline: number | null; groups: readonly ContentStatusGroup[] }

// Uses the saved evaluation day, never the PC clock or generated reason text.
// A row can need both deadline attention and verification; counts overlap.
export function contentStatusRows(snapshot: ContentSnapshot, asOf: string): ContentStatusRow[] {
  if (snapshot.rows.length > 200) throw new AppError('TABLE_LIMIT', 'En fazla iki yüz içerik durumu gösterilir.');
  const day = civilDay(asOf);
  return snapshot.rows.map(row => {
    const daysToDeadline = row.deadline ? civilDay(row.deadline) - day : null;
    const groups: ContentStatusGroup[] = ['all'];
    if (row.published === true) groups.push('published');
    else {
      if (daysToDeadline !== null && daysToDeadline < 0) groups.push('overdue');
      if (daysToDeadline !== null && daysToDeadline >= 0 && daysToDeadline <= 7) groups.push('due-soon');
      if (Object.values(row.stages).includes('missing')) groups.push('missing');
      if (row.published === null || row.deadline === null || Object.values(row.stages).includes('unknown')) groups.push('needs-check');
    }
    return { row, daysToDeadline, groups };
  });
}
