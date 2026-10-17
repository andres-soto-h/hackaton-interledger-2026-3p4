import { beforeEach, describe, expect, it } from 'vitest'
import { createSessionService } from '../../src/shared/session/session.service.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { caught } from '../helpers/errors.js'
import { decodeJwtPayload, signJwt, unsignedJwt } from '../helpers/jwt.js'

const KEY = 'k'.repeat(64)
const T0 = Date.UTC(2026, 9, 17, 10, 0, 0)
const NOW_S = T0 / 1000

let clock = T0
const sessions = () =>
  createSessionService({ signingKey: KEY, ttlSeconds: 3600, now: () => clock })

const claims = (overrides: Record<string, unknown> = {}) => ({
  sub: 'usr_1',
  iss: 'tranqui-api',
  aud: 'tranqui-app',
  iat: NOW_S,
  exp: NOW_S + 3600,
  ...overrides
})

const expectInvalid = async (token: string) => {
  const error = await caught(() => sessions().verify(token))
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ status: 401, code: 'SESSION_INVALID' })
}

beforeEach(() => {
  clock = T0
})

// Caso 10 (servicio de sesión)
describe('SessionService.issue', () => {
  it('emite un JWT HS256 con sub, iss, aud, iat y exp', () => {
    const session = sessions().issue('usr_1')
    expect(session.expiresAt).toBe(new Date((NOW_S + 3600) * 1000).toISOString())
    expect(decodeJwtPayload(session.token)).toEqual(claims())
    const header = JSON.parse(
      Buffer.from(session.token.split('.')[0] ?? '', 'base64url').toString('utf8')
    ) as unknown
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
  })

  it('respeta SESSION_TTL_SECONDS', () => {
    const short = createSessionService({
      signingKey: KEY,
      ttlSeconds: 60,
      now: () => clock
    })
    expect(decodeJwtPayload(short.issue('usr_1').token)).toMatchObject({
      exp: NOW_S + 60
    })
  })
})

describe('SessionService.verify', () => {
  it('devuelve userId, iat y exp de un token propio', () => {
    const service = sessions()
    expect(service.verify(service.issue('usr_1').token)).toEqual({
      userId: 'usr_1',
      sessionVersion: 0,
      iat: NOW_S,
      exp: NOW_S + 3600
    })
  })

  // Spec 021: cutting sessions with the user's `sessionVersion`.
  it('sin sessionVersion el token no lleva `sv` y se verifica como versión 0', () => {
    const service = sessions()
    const token = service.issue('usr_1').token
    expect(decodeJwtPayload(token)).not.toHaveProperty('sv')
    expect(service.verify(token).sessionVersion).toBe(0)
  })

  it('emite `sv` con la versión dada y la devuelve al verificar', () => {
    const service = sessions()
    const token = service.issue('usr_1', 3).token
    expect(decodeJwtPayload(token)).toMatchObject({ sv: 3 })
    expect(service.verify(token).sessionVersion).toBe(3)
  })

  it('rechaza un `sv` que no es un entero no negativo', async () => {
    await expectInvalid(signJwt(claims({ sv: -1 }), KEY))
    await expectInvalid(signJwt(claims({ sv: 'uno' }), KEY))
    await expectInvalid(signJwt(claims({ sv: 1.5 }), KEY))
  })

  it('acepta un token hecho a mano con la misma llave', () => {
    expect(sessions().verify(signJwt(claims(), KEY)).userId).toBe('usr_1')
  })

  it.each([
    ['con otra llave', () => signJwt(claims(), 'x'.repeat(64))],
    [
      'con la firma alterada',
      () => {
        const token = signJwt(claims(), KEY)
        return token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
      }
    ],
    [
      'con el payload alterado',
      () => {
        const [h, , s] = signJwt(claims(), KEY).split('.')
        const forged = Buffer.from(JSON.stringify(claims({ sub: 'usr_2' }))).toString(
          'base64url'
        )
        return `${h}.${forged}.${s}`
      }
    ],
    ['con alg none', () => unsignedJwt(claims())],
    [
      'con alg distinto de HS256',
      () => signJwt(claims(), KEY, { alg: 'HS512', typ: 'JWT' })
    ],
    ['vencido', () => signJwt(claims({ exp: NOW_S - 1 }), KEY)],
    ['con otro issuer', () => signJwt(claims({ iss: 'other' }), KEY)],
    ['con otra audience', () => signJwt(claims({ aud: 'other' }), KEY)],
    ['sin sub', () => signJwt({ ...claims(), sub: undefined }, KEY)],
    ['mal formado', () => 'not-a-jwt'],
    ['vacío', () => '']
  ])('rechaza un token %s', async (_name, build) => {
    await expectInvalid(build())
  })

  it('vence con el reloj', async () => {
    const service = sessions()
    const { token } = service.issue('usr_1')
    clock = T0 + 3600 * 1000
    await expectInvalid(token)
  })
})

describe('SessionService.isRecent', () => {
  it('compara iat con el reloj', () => {
    const service = sessions()
    const verified = service.verify(service.issue('usr_1').token)
    clock = T0 + 299_000
    expect(service.isRecent(verified, 300)).toBe(true)
    clock = T0 + 301_000
    expect(service.isRecent(verified, 300)).toBe(false)
  })
})
