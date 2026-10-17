import { useEffect, useState } from 'react';

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos que faltan hasta `confirmBy` (`null` si no se conoce). Se actualiza cada segundo. */
export function useCountdown(confirmBy?: string): { secondsLeft: number | null; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!confirmBy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [confirmBy]);
  const secondsLeft = confirmBy ? Math.max(0, Math.ceil((Date.parse(confirmBy) - now) / 1000)) : null;
  return { secondsLeft, expired: secondsLeft === 0 };
}
