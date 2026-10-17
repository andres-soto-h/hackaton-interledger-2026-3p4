import type { RequestHandler } from 'express'
import { AppError } from './app-error.js'

/** Catch-all for routes that do not exist. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'))
}
