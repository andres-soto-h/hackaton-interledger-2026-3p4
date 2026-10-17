/** Runs `fn` and returns what it threw (sync or async); fails if nothing was thrown. */
export async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the call to throw')
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: { path: string; message: string }[]
}

/** Typed `error` object of an API error response (supertest bodies are `any`). */
export const errorOf = (res: { body: unknown }): ApiErrorBody =>
  (res.body as { error: ApiErrorBody }).error
