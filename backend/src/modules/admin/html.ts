/** HTML marked as safe: `html` and `raw` produce this so it is never re-escaped. */
export interface SafeHtml {
  toString(): string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** Escapes the characters that could break out of HTML text or attributes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

class SafeHtmlValue implements SafeHtml {
  constructor(private readonly value: string) {}

  toString(): string {
    return this.value
  }
}

/** Marks a string as trusted HTML: inserted without escaping. */
export function raw(text: string): SafeHtml {
  return new SafeHtmlValue(text)
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return ''
  if (value instanceof SafeHtmlValue) return value.toString()
  if (Array.isArray(value)) return value.map(render).join('')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return escapeHtml(value)
  return ''
}

/**
 * Tagged template that escapes every interpolation by default. Interpolated
 * `SafeHtml` values (from `html` or `raw`) are not escaped again, arrays are
 * joined, `null`/`undefined`/`false` become empty and numbers become text.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = ''
  strings.forEach((part, index) => {
    out += part.trim()
    if (index < values.length) out += render(values[index])
  })
  return new SafeHtmlValue(out)
}
