export interface Period {
  start: Date
  end: Date
}

/** Formats the local date/time parts of `date` as the corresponding UTC values. */
function localParts(
  date: Date,
  timeZone: string
): {
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)

  const values: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0
  }
}

/** Offset (minutes, east-positive) of the timezone at `date`, via `Intl`. */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)

  const values: Record<string, number> = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    values.year ?? 0,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0
  )
  return (asUtc - date.getTime()) / 60_000
}

/**
 * The 00:00–00:00 (next day) period of the configured timezone containing
 * `now`. The offset is resolved with `Intl` and re-checked at the candidate
 * instant, so the result stays correct across DST transitions.
 */
export function currentPeriod(now: Date, timeZone: string): Period {
  const { year, month, day } = localParts(now, timeZone)

  const naive = Date.UTC(year, month - 1, day)
  const firstOffset = offsetMinutes(new Date(naive), timeZone)
  let start = naive - firstOffset * 60_000
  const secondOffset = offsetMinutes(new Date(start), timeZone)
  if (secondOffset !== firstOffset) {
    start = naive - secondOffset * 60_000
  }

  return {
    start: new Date(start),
    end: new Date(start + 24 * 3600 * 1000)
  }
}

/** `R/<ISO sin milisegundos>/P1D`, the Open Payments daily interval. */
export function dailyInterval(start: Date): string {
  const iso = start.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `R/${iso}/P1D`
}
