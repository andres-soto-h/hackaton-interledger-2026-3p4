import { newId } from '../ids/ids.js'
import type {
  ActivityEvent,
  ActivityEventInput,
  ActivityListOptions,
  ActivityListResult,
  ActivityLog
} from './activity-log.js'
import { sanitizeEventData } from './event-types.js'

const DAY_SECONDS = 86_400
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100

export interface InMemoryActivityLogOptions {
  now?: () => number
}

/** In-memory `ActivityLog` (spec 020). Ids use the `evt_` ULID prefix. */
export function createInMemoryActivityLog(
  options: InMemoryActivityLogOptions = {}
): ActivityLog {
  const now = options.now ?? (() => Date.now())
  const events: ActivityEvent[] = []

  return {
    record(input: ActivityEventInput): Promise<ActivityEvent> {
      const timestamp = now()
      const event: ActivityEvent = {
        id: newId('evt', timestamp),
        createdAt: new Date(timestamp).toISOString(),
        level: input.level ?? 'info',
        type: input.type,
        ...(input.paymentId !== undefined ? { paymentId: input.paymentId } : {}),
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
        message: input.message,
        data: sanitizeEventData(input.type, input.data),
        expiresAt: Math.floor(timestamp / 1000) + 7 * DAY_SECONDS
      }
      events.push(event)
      return Promise.resolve(event)
    },

    list(options: ActivityListOptions = {}): Promise<ActivityListResult> {
      const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const afterIndex =
        options.after === undefined ? -1 : events.findIndex((e) => e.id === options.after)

      const items = events
        .filter((event, index) => {
          if (index <= afterIndex) return false
          if (options.paymentId !== undefined && event.paymentId !== options.paymentId) {
            return false
          }
          if (options.type !== undefined && event.type !== options.type) return false
          if (options.level !== undefined && event.level !== options.level) return false
          return true
        })
        .slice(0, limit)

      const nextCursor =
        items.length > 0
          ? items[items.length - 1]!.id
          : options.after !== undefined
            ? options.after
            : undefined

      return Promise.resolve(nextCursor !== undefined ? { items, nextCursor } : { items })
    }
  }
}
