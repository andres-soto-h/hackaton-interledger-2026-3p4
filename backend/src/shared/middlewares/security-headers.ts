import helmet from 'helmet'
import type { RequestHandler } from 'express'

/** Default helmet security headers (CSP, HSTS, `nosniff`, …). */
export const securityHeaders = (): RequestHandler => helmet()
