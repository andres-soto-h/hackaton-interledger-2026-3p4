import cors from 'cors'
import type { RequestHandler } from 'express'

const noCors: RequestHandler = (_req, _res, next) => next()

/** Exact-origin CORS allowlist. An empty list disables CORS entirely. */
export const corsMiddleware = (allowedOrigins: string[] = []): RequestHandler =>
  allowedOrigins.length === 0 ? noCors : cors({ origin: allowedOrigins })
