import express, { type Request, type RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

const hasBody = (req: Request): boolean => {
  const length = req.headers['content-length']
  const encoding = req.headers['transfer-encoding']
  return (length !== undefined && length !== '0') || encoding !== undefined
}

/** The admin panel parses its own urlencoded forms; skip JSON handling there. */
const isAdminPath = (path: string): boolean =>
  path === '/admin' || path.startsWith('/admin/')

/**
 * Parses JSON bodies up to 16 kb. A POST/PUT/PATCH with a non-JSON
 * Content-Type is rejected with 415; a request without a body passes through.
 */
export const jsonBody = (): RequestHandler => {
  const parser = express.json({ limit: '16kb' })

  return (req, res, next) => {
    if (isAdminPath(req.path)) {
      next()
      return
    }
    if (BODY_METHODS.has(req.method) && hasBody(req) && !req.is('json')) {
      next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be JSON'))
      return
    }
    parser(req, res, next)
  }
}
