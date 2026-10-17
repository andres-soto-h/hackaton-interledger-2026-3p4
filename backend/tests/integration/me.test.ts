import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSessionService } from '../../src/shared/session/session.service.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import { signJwt, unsignedJwt } from '../helpers/jwt.js'
import {
  buildAuthContext,
  SESSION_KEY,
  START,
  type AuthContext
} from '../helpers/auth-context.js'

let ctx: AuthContext
beforeEach(() => {
  ctx = buildAuthContext()
})

const getMe = (authorization?: string) => {
  const req = request(ctx.app).get('/api/v1/me')
  return authorization === undefined ? req : req.set('authorization', authorization)
}
const deleteMe = (authorization?: string) => {
  const req = request(ctx.app).delete('/api/v1/me')
  return authorization === undefined ? req : req.set('authorization', authorization)
}

const NOW_S = START / 1000
const claims = (overrides: Record<string, unknown> = {}) => ({
  sub: 'usr_x',
  iss: 'tranqui-api',
  aud: 'tranqui-app',
  iat: NOW_S,
  exp: NOW_S + 3600,
  ...overrides
})

// Caso 10
describe('GET /api/v1/me', () => {
  it('con sesión válida devuelve los datos del usuario (y nada más), sin API key', async () => {
    const { user, token } = await ctx.seedUser()
    const res = await getMe(`Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: user.id,
      displayName: 'Alice',
      walletAddress: user.walletAddress,
      createdAt: user.createdAt
    })
  })

  it.each([
    ['sin Authorization', undefined],
    ['con esquema Basic', 'Basic abc'],
    ['con Bearer vacío', 'Bearer '],
    ['con un token mal formado', 'Bearer not-a-jwt']
  ])('%s → 401 SESSION_INVALID', async (_name, header) => {
    const res = await getMe(header)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('con el JWT alterado → 401 SESSION_INVALID', async () => {
    const { token } = await ctx.seedUser()
    const res = await getMe(
      `Bearer ${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    )
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('con un JWT vencido → 401 SESSION_INVALID', async () => {
    const { token } = await ctx.seedUser()
    ctx.clock.advanceSeconds(3601)
    const res = await getMe(`Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('con alg none o firmado con otra llave → 401 SESSION_INVALID', async () => {
    const { user } = await ctx.seedUser()
    for (const token of [
      unsignedJwt(claims({ sub: user.id })),
      signJwt(claims({ sub: user.id }), 'x'.repeat(64))
    ]) {
      const res = await getMe(`Bearer ${token}`)
      expect(res.status).toBe(401)
      expect(errorOf(res).code).toBe('SESSION_INVALID')
    }
  })

  it('un token hecho a mano con la llave correcta sí funciona', async () => {
    const { user } = await ctx.seedUser()
    const res = await getMe(`Bearer ${signJwt(claims({ sub: user.id }), SESSION_KEY)}`)
    expect(res.status).toBe(200)
  })

  // Caso 11
  it('sesión de una cuenta ya borrada → 401 SESSION_INVALID', async () => {
    const { user, token } = await ctx.seedUser()
    await ctx.users.deleteUserAndCredentials(user.id)
    const res = await getMe(`Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('sesión de una cuenta bloqueada → 401 SESSION_INVALID', async () => {
    const { user, token } = await ctx.seedUser()
    await ctx.users.setUserStatus(user.id, 'BLOCKED', new Date(START).toISOString())
    const res = await getMe(`Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })
})

// Caso 12
describe('DELETE /api/v1/me', () => {
  it('con sesión reciente → 204 y borra cuenta, passkeys y unicidad de la wallet', async () => {
    const { user, token } = await ctx.seedUser()
    ctx.clock.advanceSeconds(120)
    const res = await deleteMe(`Bearer ${token}`)
    expect(res.status).toBe(204)
    expect(res.text).toBe('')

    expect(await ctx.users.getUser(user.id)).toBeNull()
    expect(await ctx.users.getCredential('cred-alice-1')).toBeNull()
    expect(await ctx.users.findUserByWallet(user.walletAddress)).toBeNull()
    expect((await getMe(`Bearer ${token}`)).status).toBe(401)
  })

  it('con una sesión de más de 5 minutos → 401 REAUTH_REQUIRED y no borra nada', async () => {
    const { user, token } = await ctx.seedUser()
    ctx.clock.advanceSeconds(301)
    const res = await deleteMe(`Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('REAUTH_REQUIRED')
    expect(await ctx.users.getUser(user.id)).not.toBeNull()
    expect(await ctx.users.getCredential('cred-alice-1')).not.toBeNull()
  })

  it('una sesión nueva tras volver a usar el passkey sí puede borrar', async () => {
    const { user } = await ctx.seedUser()
    ctx.clock.advanceSeconds(1800)
    const fresh = createSessionService({
      signingKey: SESSION_KEY,
      ttlSeconds: 3600,
      now: () => START + 1800 * 1000
    }).issue(user.id)
    const res = await deleteMe(`Bearer ${fresh.token}`)
    expect(res.status).toBe(204)
  })

  it('sin sesión → 401 SESSION_INVALID', async () => {
    const res = await deleteMe()
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('el registro de la wallet queda libre para una cuenta nueva', async () => {
    const { token } = await ctx.seedUser()
    await deleteMe(`Bearer ${token}`)
    const res = await request(ctx.app)
      .post('/api/v1/auth/register/options')
      .send({ displayName: 'Alice', walletAddress: '$ilp.interledger-test.dev/alice' })
    expect(res.status).toBe(200)
    expect(bodyOf<{ challengeId: string }>(res).challengeId).toMatch(/^chl_/)
  })
})

// Spec 021: la versión de sesión corta las sesiones previas.
describe('sessionVersion en userAuth', () => {
  it('un token con la versión actual del usuario funciona y uno anterior deja de servir', async () => {
    const { user, token } = await ctx.seedUser()
    expect((await getMe(`Bearer ${token}`)).status).toBe(200)

    const version = await ctx.users.bumpSessionVersion(user.id, user.updatedAt)
    expect(version).toBe(1)

    const old = await getMe(`Bearer ${token}`)
    expect(old.status).toBe(401)
    expect(errorOf(old).code).toBe('SESSION_INVALID')

    const fresh = ctx.sessions.issue(user.id, version).token
    expect((await getMe(`Bearer ${fresh}`)).status).toBe(200)
  })

  it('un token con versión mayor que la del usuario tampoco sirve', async () => {
    const { user } = await ctx.seedUser()
    const forged = ctx.sessions.issue(user.id, 5).token
    expect((await getMe(`Bearer ${forged}`)).status).toBe(401)
  })

  it('un usuario bloqueado recibe 401 aunque la versión coincida', async () => {
    const { user, token } = await ctx.seedUser()
    await ctx.users.setUserStatus(user.id, 'BLOCKED', user.updatedAt)
    expect((await getMe(`Bearer ${token}`)).status).toBe(401)
  })
})
