import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildAuthContext,
  ORIGINS,
  RP_ID,
  type AuthContext
} from '../helpers/auth-context.js'

interface OptionsBody {
  challengeId: string
  options: { challenge: string }
}
interface LoginBody {
  user: { id: string; displayName: string; walletAddress: string; createdAt: string }
  session: { token: string; expiresAt: string }
}

let ctx: AuthContext
beforeEach(() => {
  ctx = buildAuthContext()
})

const loginOptions = () => request(ctx.app).post('/api/v1/auth/login/options')
const loginVerify = (body: unknown) =>
  request(ctx.app)
    .post('/api/v1/auth/login/verify')
    .send(body as object)

const startLogin = async () => {
  const res = await loginOptions()
  expect(res.status).toBe(200)
  return bodyOf<OptionsBody>(res)
}

describe('POST /api/v1/auth/login/options', () => {
  it('devuelve opciones sin pedir usuario y guarda el challenge', async () => {
    const res = await loginOptions()
    expect(res.status).toBe(200)
    const body = bodyOf<OptionsBody>(res)
    expect(body.challengeId).toMatch(/^chl_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(body.options.challenge).toBe('login-challenge-1')
    expect(ctx.verifier.calls.authenticationOptions[0]).toMatchObject({ rpID: RP_ID })
  })
})

// Caso 7
describe('POST /api/v1/auth/login/verify', () => {
  it('login válido: devuelve la sesión y actualiza contador y último uso', async () => {
    const { user } = await ctx.seedUser({ credential: { counter: 4 } })
    const { challengeId, options } = await startLogin()
    ctx.clock.advanceSeconds(60)

    const res = await loginVerify({
      challengeId,
      credential: { id: 'cred-alice-1', newCounter: 5 }
    })

    expect(res.status).toBe(200)
    const body = bodyOf<LoginBody>(res)
    expect(body.user).toEqual({
      id: user.id,
      displayName: 'Alice',
      walletAddress: user.walletAddress,
      createdAt: user.createdAt
    })
    expect(ctx.sessions.verify(body.session.token).userId).toBe(user.id)
    expect(await ctx.users.getCredential('cred-alice-1')).toMatchObject({
      counter: 5,
      lastUsedAt: new Date(Date.UTC(2026, 9, 17, 10, 1, 0)).toISOString()
    })
    expect(ctx.verifier.calls.verifyAuthentication[0]).toMatchObject({
      expectedChallenge: options.challenge,
      expectedOrigins: ORIGINS,
      expectedRPID: RP_ID,
      stored: { publicKey: 'public-key-alice-1', counter: 4 }
    })
  })

  it('los passkeys sincronizados (contador siempre 0) pueden iniciar sesión varias veces', async () => {
    await ctx.seedUser({ credential: { counter: 0 } })
    for (let i = 0; i < 2; i += 1) {
      const { challengeId } = await startLogin()
      const res = await loginVerify({
        challengeId,
        credential: { id: 'cred-alice-1', newCounter: 0 }
      })
      expect(res.status).toBe(200)
    }
  })

  // Caso 8
  it('passkey desconocido → 400 PASSKEY_VERIFICATION_FAILED', async () => {
    await ctx.seedUser()
    const { challengeId } = await startLogin()
    const res = await loginVerify({ challengeId, credential: { id: 'cred-unknown' } })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
  })

  it.each([
    ['retrocede', 5],
    ['no avanza', 10]
  ])(
    'contador que %s → 400 PASSKEY_VERIFICATION_FAILED y no actualiza nada',
    async (_name, newCounter) => {
      await ctx.seedUser({ credential: { counter: 10 } })
      const { challengeId } = await startLogin()
      const res = await loginVerify({
        challengeId,
        credential: { id: 'cred-alice-1', newCounter }
      })
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
      expect((await ctx.users.getCredential('cred-alice-1'))?.counter).toBe(10)
    }
  )

  it('firma inválida → 400 PASSKEY_VERIFICATION_FAILED', async () => {
    await ctx.seedUser()
    const { challengeId } = await startLogin()
    const res = await loginVerify({
      challengeId,
      credential: { id: 'cred-alice-1', ok: false }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
  })

  it('challenge usado, vencido, inexistente o de registro → 400 CHALLENGE_EXPIRED', async () => {
    await ctx.seedUser()
    const used = await startLogin()
    expect(
      (
        await loginVerify({
          challengeId: used.challengeId,
          credential: { id: 'cred-alice-1' }
        })
      ).status
    ).toBe(200)
    const reused = await loginVerify({
      challengeId: used.challengeId,
      credential: { id: 'cred-alice-1' }
    })
    expect(errorOf(reused).code).toBe('CHALLENGE_EXPIRED')

    const old = await startLogin()
    ctx.clock.advanceSeconds(301)
    const expired = await loginVerify({
      challengeId: old.challengeId,
      credential: { id: 'cred-alice-1' }
    })
    expect(errorOf(expired).code).toBe('CHALLENGE_EXPIRED')

    const missing = await loginVerify({
      challengeId: 'chl_NOPE',
      credential: { id: 'cred-alice-1' }
    })
    expect(errorOf(missing).code).toBe('CHALLENGE_EXPIRED')

    const register = await request(ctx.app)
      .post('/api/v1/auth/register/options')
      .send({ displayName: 'Bob', walletAddress: '$ilp.interledger-test.dev/bob' })
    const wrongType = await loginVerify({
      challengeId: bodyOf<OptionsBody>(register).challengeId,
      credential: { id: 'cred-alice-1' }
    })
    expect(errorOf(wrongType).code).toBe('CHALLENGE_EXPIRED')
  })

  it('dos verificaciones en paralelo con el mismo challenge: solo una tiene éxito', async () => {
    await ctx.seedUser()
    const { challengeId } = await startLogin()
    const [a, b] = await Promise.all([
      loginVerify({ challengeId, credential: { id: 'cred-alice-1' } }),
      loginVerify({ challengeId, credential: { id: 'cred-alice-1' } })
    ])
    expect([a.status, b.status].sort()).toEqual([200, 400])
  })

  // Caso 9
  it('usuario bloqueado → 401 SESSION_INVALID y no se actualiza el passkey', async () => {
    const { user } = await ctx.seedUser({ credential: { counter: 1 } })
    await ctx.users.setUserStatus(user.id, 'BLOCKED', new Date().toISOString())
    const { challengeId } = await startLogin()
    const res = await loginVerify({
      challengeId,
      credential: { id: 'cred-alice-1', newCounter: 2 }
    })
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
    expect((await ctx.users.getCredential('cred-alice-1'))?.counter).toBe(1)
  })

  it.each([
    ['sin challengeId', { credential: { id: 'x' } }],
    ['sin credential', { challengeId: 'chl_X' }],
    [
      'con campos desconocidos',
      { challengeId: 'chl_X', credential: { id: 'x' }, extra: 1 }
    ]
  ])('rechaza el body %s con 400 VALIDATION_ERROR', async (_name, body) => {
    const res = await loginVerify(body)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })
})
