// Capture age is not a claim about whether the remote page itself is up to date.
// Recomputed on owner rendering only; no timer, model, network or persistence.
export function sourceFreshness(readAt: string, now = Date.now()): string {
  const captured = Date.parse(readAt);
  if (!Number.isFinite(captured) || !Number.isFinite(now)) return 'Okuma tarihi doğrulanamadı.';
  if (captured > now + 60_000) return 'Okuma tarihi ileride görünüyor; bilgisayar saatini kontrol et.';
  const days = Math.floor(Math.max(0, now - captured) / 86_400_000);
  return `${days ? `${days} gün önce okundu` : 'Son 24 saat içinde okundu'} · Canlı kontrol yapılmadı.`;
}
