import type { Request, RequestHandler } from 'express'
import { z } from 'zod'
import { AppError, type ErrorDetail } from '../errors/app-error.js'

export interface ValidationSchema {
  body?: z.ZodType
  query?: z.ZodType
  params?: z.ZodType
}

interface IssueLike {
  path: PropertyKey[]
  keys?: string[]
  message: string
}

const parseOne = (
  schema: z.ZodType | undefined,
  input: unknown,
  details: ErrorDetail[]
): unknown => {
  if (schema === undefined) return input
  const result = schema.safeParse(input)
  if (result.success) return result.data
  for (const issue of result.error.issues as IssueLike[]) {
    // Zod reports unknown object keys via `keys` with an empty `path`.
    const paths = issue.keys ?? issue.path
    details.push({ path: paths.join('.'), message: issue.message })
  }
  return input
}

/** Express 5 exposes `query`/`params` as getters; shadow them with own values. */
const defineParsed = (req: Request, key: 'query' | 'params', value: unknown): void => {
  Object.defineProperty(req, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  })
}

/**
 * Validates `body`, `query` and `params` with Zod. On failure it responds with
 * `400 VALIDATION_ERROR` and a `details` list of dotted paths; on success it
 * writes the parsed values back so handlers receive coerced data.
 */
export const validate =
  (schema: ValidationSchema): RequestHandler =>
  (req, _res, next) => {
    const details: ErrorDetail[] = []

    const body = parseOne(schema.body, req.body, details)
    const query = parseOne(schema.query, req.query, details)
    const params = parseOne(schema.params, req.params, details)

    if (details.length > 0) {
      next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', details))
      return
    }

    req.body = body
    if (schema.query !== undefined) defineParsed(req, 'query', query)
    if (schema.params !== undefined) defineParsed(req, 'params', params)
    next()
  }
