import { z } from 'zod'

/** Positive decimal in string form: `0.01`, `10`, `10.50`, no exponents. */
const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

/** C0 controls and DEL are not allowed in a description. */
const hasControlCharacter = (value: string): boolean => {
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export const amountSchema = z.strictObject({
  value: z
    .string()
    .regex(DECIMAL_RE, 'Invalid amount value')
    .refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero'),
  assetCode: z.string().regex(/^[A-Z]{3}$/, 'Invalid asset code')
})

export const walletAddressSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value.startsWith('https://')) {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    }
    return /^\$[^/\s]+(?:\/[^\s]*)?$/.test(value)
  }, 'Invalid wallet address')

export const descriptionSchema = z
  .string()
  .max(140)
  .refine((value) => !hasControlCharacter(value), 'No control characters')
  .optional()

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
})
