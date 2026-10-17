/** Typed view of a supertest response body (supertest types it as `any`). */
export const bodyOf = <T>(res: { body: unknown }): T => res.body as T
