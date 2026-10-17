import { createHmac } from 'node:crypto'

const b64 = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** HS256 JWT signed by the test, to forge cookies with other audiences or expirations. */
export function signJwt(key: string, claims: Record<string, unknown>): string {
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`
  const signature = createHmac('sha256', key).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}
