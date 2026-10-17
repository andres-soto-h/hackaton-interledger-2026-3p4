import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyOf } from '../helpers/body.js'
import { buildAuthContext, type AuthContext } from '../helpers/auth-context.js'

/**
 * `PASSKEY_BYPASS` (spec 019, caso de prueba local): cuando está activo, el
 * registro y el ingreso no verifican WebAuthn y emiten la sesión igual.
 */
interface OptionsBody {
  challengeId: string
  options: { challenge: string }
}
interface AuthBody {
  user: { id: string; displayName: string; walletAddress: string; createdAt: string }
  session: { token: string; expiresAt: string }
}

let ctx: AuthContext
beforeEach(() => {
  ctx = buildAuthContext({ passkeyBypass: true })
})

const startRegistration = async () => {
  const res = await request(ctx.app)
    .post('/api/v1/auth/register/options')
    .send({ displayName: 'Alice', walletAddress: '$ilp.interledger-test.dev/alice' })
  expect(res.status).toBe(200)
  return bodyOf<OptionsBody>(res)
}

const startLogin = async () => {
  const res = await request(ctx.app).post('/api/v1/auth/login/options')
  expect(res.status).toBe(200)
  return bodyOf<OptionsBody>(res)
}

describe('registro con PASSKEY_BYPASS', () => {
  it('crea la cuenta sin verificar el passkey y devuelve sesión', async () => {
    const { challengeId } = await startRegistration()
    const res = await request(ctx.app)
      .post('/api/v1/auth/register/verify')
      .send({ challengeId, credential: { id: 'cualquier-cosa' } })

    expect(res.status).toBe(201)
    const body = bodyOf<AuthBody>(res)
    expect(body.user.displayName).toBe('Alice')
    expect(ctx.sessions.verify(body.session.token).userId).toBe(body.user.id)

    // No se invocó WebAuthn y la cuenta quedó con un credential sintético.
    expect(ctx.verifier.calls.verifyRegistration).toHaveLength(0)
    const credentials = await ctx.users.listCredentials(body.user.id)
    expect(credentials).toHaveLength(1)
    expect(credentials[0]?.id).toBe(`bypass_${body.user.id}`)
  })
})

describe('ingreso con PASSKEY_BYPASS', () => {
  it('entra como la cuenta activa más reciente sin verificar el passkey', async () => {
    const { user } = await ctx.seedUser()
    const { challengeId } = await startLogin()
    const res = await request(ctx.app)
      .post('/api/v1/auth/login/verify')
      .send({ challengeId, credential: { id: 'cualquier-cosa' } })

    expect(res.status).toBe(200)
    const body = bodyOf<AuthBody>(res)
    expect(body.user.id).toBe(user.id)
    expect(ctx.sessions.verify(body.session.token).userId).toBe(user.id)
    expect(ctx.verifier.calls.verifyAuthentication).toHaveLength(0)
  })

  it('sin cuentas activas → 401 SESSION_INVALID', async () => {
    const { challengeId } = await startLogin()
    const res = await request(ctx.app)
      .post('/api/v1/auth/login/verify')
      .send({ challengeId, credential: { id: 'cualquier-cosa' } })
    expect(res.status).toBe(401)
  })
})
