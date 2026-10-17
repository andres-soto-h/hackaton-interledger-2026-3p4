export type BeginResult =
  | { kind: 'new' }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' }
  | { kind: 'replay'; status: number; body: unknown }

/** Port for idempotency records. The in-memory implementation lives here; DynamoDB comes later. */
export interface IdempotencyStore {
  begin(key: string, bodyHash: string, ttlSeconds: number): Promise<BeginResult>
  complete(key: string, status: number, body: unknown): Promise<void>
  release(key: string): Promise<void>
}
