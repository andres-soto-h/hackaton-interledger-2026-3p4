import type { ErrorRequestHandler } from 'express'
import type { Logger } from '../logger.js'
import { AppError, errorBody } from './app-error.js'

/** Error raised by express.json() when the body is not valid JSON. */
const isJsonParseError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { type?: unknown }).type === 'entity.parse.failed'

/**
 * Central error middleware: every error leaves the API with the standard
 * format, and unexpected errors never expose their message or stack.
 */
export const errorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err)
      return
    }

    if (err instanceof AppError) {
      res.status(err.status).json(errorBody(err.code, err.message))
      return
    }

    if (isJsonParseError(err)) {
      res.status(400).json(errorBody('INVALID_JSON', 'Malformed JSON body'))
      return
    }

    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error')
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Internal server error'))
  }
