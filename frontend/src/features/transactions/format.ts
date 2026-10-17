const TIME_ZONE = 'America/Bogota';

const time = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TIME_ZONE,
});
const dayMonth = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }); // AAAA-MM-DD

function dayNumber(date: Date): number {
  const [y, m, d] = dayKey.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** "hoy, 3:24 p. m." · "ayer, 9:05 a. m." · "12 oct, 3:24 p. m." (hora de Bogotá). */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const clock = time.format(date).replace(/ | /g, ' ');
  const diff = dayNumber(now) - dayNumber(date);
  if (diff === 0) return `hoy, ${clock}`;
  if (diff === 1) return `ayer, ${clock}`;
  return `${dayMonth.format(date).replace(/ de /, ' ').replace('.', '')}, ${clock}`;
}

/** Nombre a mostrar: el del backend o, si no hay, el host y la ruta de la wallet. */
export function counterpartyName(c: { name: string | null; walletAddress: string }): string {
  if (c.name) return c.name;
  try {
    const url = new URL(c.walletAddress);
    return `${url.host}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return c.walletAddress;
  }
}
