export interface ErrorDetail {
  path: string
  message: string
}

/** Expected error: its status, code and message are safe to send to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[]
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: ErrorDetail[] }
}

export const errorBody = (
  code: string,
  message: string,
  details?: ErrorDetail[]
): ErrorBody => {
  const error: ErrorBody['error'] = { code, message }
  if (details !== undefined && details.length > 0) {
    error.details = details
  }
  return { error }
}
