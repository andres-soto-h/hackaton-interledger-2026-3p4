export interface LoginAttemptsStore {
  isBlocked(ip: string, nowMs: number): boolean
  recordFailure(ip: string, nowMs: number): void
  reset(ip: string): void
}

export interface LoginAttemptsOptions {
  windowMs?: number
  maxFailures?: number
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_FAILURES = 5

/** In-memory login failure tracking per IP (spec 020). */
export function createInMemoryLoginAttempts(
  options: LoginAttemptsOptions = {}
): LoginAttemptsStore {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES
  const failures = new Map<string, number[]>()

  const recent = (ip: string, nowMs: number): number[] =>
    (failures.get(ip) ?? []).filter((timestamp) => nowMs - timestamp < windowMs)

  return {
    isBlocked(ip, nowMs) {
      return recent(ip, nowMs).length >= maxFailures
    },

    recordFailure(ip, nowMs) {
      const timestamps = recent(ip, nowMs)
      timestamps.push(nowMs)
      failures.set(ip, timestamps)
    },

    reset(ip) {
      failures.delete(ip)
    }
  }
}
