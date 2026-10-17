/** Expected error: its status, code and message are safe to send to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export interface ErrorBody {
  error: { code: string; message: string }
}

export const errorBody = (code: string, message: string): ErrorBody => ({
  error: { code, message }
})
