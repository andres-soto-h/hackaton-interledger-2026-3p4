import type { BeginResult, IdempotencyStore } from './store.js'

interface InProgressRecord {
  phase: 'in_progress'
  bodyHash: string
  expiresAt: number
}

interface CompleteRecord {
  phase: 'complete'
  bodyHash: string
  status: number
  body: unknown
  expiresAt: number
}

type Record = InProgressRecord | CompleteRecord

export interface InMemoryStoreOptions {
  now?: () => number
}

/** Ephemeral idempotency store, one `Map` per instance. */
export function createInMemoryIdempotencyStore(
  options: InMemoryStoreOptions = {}
): IdempotencyStore {
  const now = options.now ?? Date.now
  const records = new Map<string, Record>()

  return {
    begin(key, bodyHash, ttlSeconds): Promise<BeginResult> {
      const current = now()
      const record = records.get(key)

      if (record === undefined || record.expiresAt <= current) {
        records.set(key, {
          phase: 'in_progress',
          bodyHash,
          expiresAt: current + ttlSeconds * 1000
        })
        return Promise.resolve({ kind: 'new' })
      }

      if (record.phase === 'in_progress') {
        return Promise.resolve({ kind: 'in_progress' })
      }

      if (record.bodyHash === bodyHash) {
        return Promise.resolve({
          kind: 'replay',
          status: record.status,
          body: record.body
        })
      }
      return Promise.resolve({ kind: 'mismatch' })
    },

    complete(key, status, body): Promise<void> {
      const record = records.get(key)
      if (record === undefined) return Promise.resolve()
      records.set(key, {
        phase: 'complete',
        bodyHash: record.bodyHash,
        status,
        body,
        expiresAt: record.expiresAt
      })
      return Promise.resolve()
    },

    release(key): Promise<void> {
      records.delete(key)
      return Promise.resolve()
    }
  }
}
