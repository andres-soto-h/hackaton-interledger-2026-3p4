import { createHmac } from 'node:crypto'

const b64 = (value: unknown): string =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
    'base64url'
  )

/** Hand-made HS256 token, independent from the code under test. */
export function signJwt(
  payload: Record<string, unknown>,
  key: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  const signingInput = `${b64(header)}.${b64(payload)}`
  const signature = createHmac('sha256', key).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

/** `alg: none` token without signature. */
export function unsignedJwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

/** HS256 JWT signed by the test, to forge cookies with other audiences or expirations. */
export function signJwtWithKey(key: string, claims: Record<string, unknown>): string {
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`
  const signature = createHmac('sha256', key).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}
