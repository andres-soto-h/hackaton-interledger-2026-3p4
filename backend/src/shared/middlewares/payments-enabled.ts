import type { RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'
import type { EditableSettingsProvider } from '../settings/editable-settings.js'

/** Rejects writes to the payments API when `paymentsEnabled` is false. */
export function requirePaymentsEnabled(
  provider: Pick<EditableSettingsProvider, 'getEditable'>
): RequestHandler {
  return async (_req, _res, next) => {
    const { settings } = await provider.getEditable()
    if (!settings.paymentsEnabled) {
      next(new AppError(503, 'PAYMENTS_DISABLED', 'Payments are temporarily disabled'))
      return
    }
    next()
  }
}
