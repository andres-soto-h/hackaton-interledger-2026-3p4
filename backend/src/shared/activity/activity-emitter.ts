import { currentRequestId } from '../request-context.js'
import type { ActivityEventInput, ActivityLog } from './activity-log.js'

/** Emits a business activity event without ever throwing (spec 022). */
export type ActivityEmitter = (input: ActivityEventInput) => Promise<void>

export interface ActivityEmitterOptions {
  log?: ActivityLog
  logger?: { warn: (...args: unknown[]) => void }
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 1000

/**
 * Wraps an `ActivityLog` in a fire-and-forget emitter that never rejects: if
 * `record` fails or takes longer than `timeoutMs`, it resolves anyway and
 * calls `logger.warn` once, without the event data. Without a `log` it is a
 * no-op. When the input has no `requestId`, the current async context id is
 * used.
 */
export function createActivityEmitter(
  options: ActivityEmitterOptions = {}
): ActivityEmitter {
  const { log, logger, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  if (log === undefined) {
    return () => Promise.resolve()
  }

  return async (input: ActivityEventInput): Promise<void> => {
    const requestId = input.requestId ?? currentRequestId()
    const event: ActivityEventInput = {
      ...input,
      ...(requestId !== undefined ? { requestId } : {})
    }

    let warned = false
    const warnOnce = (): void => {
      if (warned) return
      warned = true
      logger?.warn('Activity log record failed')
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        log.record(event),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Activity log timeout')), timeoutMs)
        })
      ])
    } catch {
      warnOnce()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
