export type ActivityLevel = 'info' | 'warn' | 'error'

export interface ActivityEventInput {
  type: string
  level?: ActivityLevel
  paymentId?: string
  requestId?: string
  message: string
  data?: Record<string, unknown>
}

export interface ActivityEvent {
  id: string
  /** ISO 8601 UTC timestamp. */
  createdAt: string
  level: ActivityLevel
  type: string
  paymentId?: string
  requestId?: string
  message: string
  data: Record<string, string>
  /** DynamoDB TTL, in epoch seconds (createdAt + 7 days). */
  expiresAt: number
}

export interface ActivityListOptions {
  /** Opaque cursor: return only events that arrive after it. */
  after?: string
  paymentId?: string
  type?: string
  level?: ActivityLevel
  limit?: number
}

export interface ActivityListResult {
  items: ActivityEvent[]
  nextCursor?: string
}

/** Business activity log (specs 020 and 022). */
export interface ActivityLog {
  record(input: ActivityEventInput): Promise<ActivityEvent>
  list(options?: ActivityListOptions): Promise<ActivityListResult>
}
