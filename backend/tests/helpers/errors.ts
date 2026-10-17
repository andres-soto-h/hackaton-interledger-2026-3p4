export interface ApiErrorBody {
  code: string
  message: string
  details?: { path: string; message: string }[]
}

/** Typed `error` object of an API error response (supertest bodies are `any`). */
export const errorOf = (res: { body: unknown }): ApiErrorBody =>
  (res.body as { error: ApiErrorBody }).error
