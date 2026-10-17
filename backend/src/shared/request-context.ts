import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<string>()

/**
 * Runs `fn` with the request id stored in the async context, so activity
 * emitters can read it later even across awaits (spec 022).
 */
export function runWithRequestId<T>(id: string, fn: () => T): T {
  return storage.run(id, fn)
}

/** Returns the request id of the current async context, if any. */
export function currentRequestId(): string | undefined {
  return storage.getStore()
}
