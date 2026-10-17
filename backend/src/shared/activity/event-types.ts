/**
 * Fields allowed per event type (spec 022). Exact types win over `prefix.*`
 * wildcards; unknown types keep an empty data object.
 */
const ALLOWED_FIELDS: Record<string, string[]> = {
  'payment.quoted': ['debitAmount', 'receiveAmount', 'rate', 'expiresAt'],
  'payment_request.created': ['amount', 'assetCode'],
  'fee.collected': ['amount', 'assetCode'],
  'fee.failed': ['error'],
  'wallet_link.requested': ['walletAddress'],
  'wallet_link.callback_received': ['walletAddress'],
  'wallet_link.active': ['walletAddress'],
  'wallet_link.rejected': ['reason'],
  'wallet_link.expired': [],
  'wallet_link.revoked': [],
  'wallet_link.callback_invalid': ['reason'],
  'wallet_link.token_rotated': [],
  'payment.*': ['amount', 'assetCode', 'error'],
  'fee.*': ['amount', 'assetCode', 'error'],
  'wallet_link.*': ['walletAddress', 'reason'],
  'user.*': ['userId'],
  'settings.updated': ['setting', 'previous', 'next']
}

const SENSITIVE =
  /token|nonce|hash|secret|password|authorization|interact|privatekey|apikey/i

function allowedFields(type: string): string[] {
  if (Object.prototype.hasOwnProperty.call(ALLOWED_FIELDS, type)) {
    return ALLOWED_FIELDS[type]!
  }
  const dot = type.lastIndexOf('.')
  if (dot !== -1) {
    const wildcard = `${type.slice(0, dot)}.*`
    if (Object.prototype.hasOwnProperty.call(ALLOWED_FIELDS, wildcard)) {
      return ALLOWED_FIELDS[wildcard]!
    }
  }
  return []
}

/**
 * Keeps only the allowed fields for the event type, converts values to strings
 * (objects are discarded) and always drops secret-looking keys.
 */
export function sanitizeEventData(
  type: string,
  data?: Record<string, unknown>
): Record<string, string> {
  if (data === undefined) return {}
  const allowed = new Set(allowedFields(type))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE.test(key)) continue
    if (!allowed.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      result[key] = value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value)
    }
  }
  return result
}
