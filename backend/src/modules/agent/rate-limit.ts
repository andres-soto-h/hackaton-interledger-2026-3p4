/**
 * Sliding-window limit per user, kept in memory per Lambda instance. It bounds
 * the cost of the model and the voice for a single user on a warm instance; it
 * is not a global quota (see DEUDA-TECNICA).
 */
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now
}: {
  max: number
  windowMs: number
  now?: () => number
}): (key: string) => boolean {
  const hits = new Map<string, number[]>()
  return (key) => {
    const current = now()
    const recent = (hits.get(key) ?? []).filter((at) => current - at < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    recent.push(current)
    hits.set(key, recent)
    return true
  }
}
