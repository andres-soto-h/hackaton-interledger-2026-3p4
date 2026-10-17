/** Runs `fn` and returns what it threw (sync or async); fails if nothing was thrown. */
export async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the call to throw')
}
