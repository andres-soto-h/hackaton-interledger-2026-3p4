import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildAuthContext,
  ORIGINS,
  RP_ID,
  wallet,
  type AuthContext
} from '../helpers/auth-context.js'

interface OptionsBody {
  challengeId: string
  options: { challenge: string }
}
interface RegisterBody {
  user: { id: string; displayName: string; walletAddress: string; createdAt: string }
  session: { token: string; expiresAt: string }
}

let ctx: AuthContext
beforeEach(() => {
  ctx = buildAuthContext()
})

const registerOptions = (body: unknown) =>
  request(ctx.app)
    .post('/api/v1/auth/register/options')
    .send(body as object)
const registerVerify = (body: unknown) =>
  request(ctx.app)
    .post('/api/v1/auth/register/verify')
    .send(body as object)

const startRegistration = async (walletAddress = '$ilp.interledger-test.dev/alice') => {
  const res = await registerOptions({ displayName: 'Alice', walletAddress })
  expect(res.status).toBe(200)
  return bodyOf<OptionsBody>(res)
}

// Caso 1
describe('POST /api/v1/auth/register/options', () => {
  it('devuelve las opciones y un challengeId, y guarda el challenge', async () => {
    const res = await registerOptions({
      displayName: 'Alice',
      walletAddress: '$ilp.interledger-test.dev/alice'
    })
    expect(res.status).toBe(200)
    const body = bodyOf<OptionsBody>(res)
    expect(body.challengeId).toMatch(/^chl_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(body.options.challenge).toBe('reg-challenge-1')

    expect(ctx.verifier.calls.registrationOptions).toHaveLength(1)
    expect(ctx.verifier.calls.registrationOptions[0]).toMatchObject({
      rpID: RP_ID,
      rpName: 'Tranqui',
      userName: 'Alice'
    })
    expect(ctx.verifier.calls.registrationOptions[0]?.userId).toMatch(/^usr_/)
  })

  it('el challenge guardado vence a los 5 minutos', async () => {
    const { challengeId } = await startRegistration()
    ctx.clock.advanceSeconds(301)
    const res = await registerVerify({ challengeId, credential: { id: 'cred-1' } })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
  })

  it('no necesita API key (ruta pública)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/register/options')
      .send({ displayName: 'Alice', walletAddress: '$ilp.interledger-test.dev/alice' })
    expect(res.status).toBe(200)
  })

  it.each([
    ['sin displayName', { walletAddress: '$ilp.interledger-test.dev/alice' }],
    [
      'con displayName vacío',
      { displayName: '', walletAddress: '$ilp.interledger-test.dev/alice' }
    ],
    [
      'con displayName largo',
      { displayName: 'a'.repeat(61), walletAddress: '$ilp.interledger-test.dev/alice' }
    ],
    ['sin walletAddress', { displayName: 'Alice' }],
    [
      'con campos desconocidos',
      {
        displayName: 'Alice',
        walletAddress: '$ilp.interledger-test.dev/alice',
        admin: true
      }
    ]
  ])('rechaza el body %s con 400 VALIDATION_ERROR', async (_name, body) => {
    const res = await registerOptions(body)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  // Caso 2
  it('wallet inexistente → 422 WALLET_NOT_FOUND', async () => {
    const res = await registerOptions({
      displayName: 'Ghost',
      walletAddress: '$ilp.interledger-test.dev/ghost'
    })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('WALLET_NOT_FOUND')
    expect(ctx.verifier.calls.registrationOptions).toHaveLength(0)
  })

  it('wallet de un host no permitido → 422 WALLET_NOT_ALLOWED', async () => {
    const res = await registerOptions({
      displayName: 'Eve',
      walletAddress: 'https://evil.example/eve'
    })
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('WALLET_NOT_ALLOWED')
  })

  // Caso 6 (aviso temprano)
  it('wallet que ya tiene cuenta → 409 WALLET_ALREADY_REGISTERED', async () => {
    await ctx.seedUser()
    const res = await registerOptions({
      displayName: 'Alice 2',
      walletAddress: '$ilp.interledger-test.dev/alice'
    })
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('WALLET_ALREADY_REGISTERED')
  })
})

// Casos 3 a 6 y 13
describe('POST /api/v1/auth/register/verify', () => {
  it('caso 3 · registro válido: crea usuario, passkey y unicidad de wallet, y devuelve la sesión', async () => {
    const { challengeId, options } = await startRegistration()
    const res = await registerVerify({
      challengeId,
      credential: { id: 'cred-alice-1', newCounter: 0 }
    })

    expect(res.status).toBe(201)
    const body = bodyOf<RegisterBody>(res)
    expect(body.user).toEqual({
      id: expect.stringMatching(/^usr_/) as string,
      displayName: 'Alice',
      walletAddress: wallet('alice').id,
      createdAt: new Date(Date.UTC(2026, 9, 17, 10, 0, 0)).toISOString()
    })
    expect(ctx.sessions.verify(body.session.token).userId).toBe(body.user.id)
    expect(body.session.expiresAt).toBe(
      new Date(Date.UTC(2026, 9, 17, 11, 0, 0)).toISOString()
    )

    const stored = await ctx.users.getUser(body.user.id)
    expect(stored).toMatchObject({
      displayName: 'Alice',
      walletAddress: wallet('alice').id,
      walletAssetCode: 'USD',
      status: 'ACTIVE'
    })
    expect(await ctx.users.getCredential('cred-alice-1')).toMatchObject({
      userId: body.user.id,
      publicKey: 'public-key-of-cred-alice-1',
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: true
    })
    expect((await ctx.users.findUserByWallet(wallet('alice').id))?.id).toBe(body.user.id)

    expect(ctx.verifier.calls.verifyRegistration[0]).toMatchObject({
      expectedChallenge: options.challenge,
      expectedOrigins: ORIGINS,
      expectedRPID: RP_ID
    })
  })

  it('el usuario guardado usa el mismo id que se pasó al verificador en las opciones', async () => {
    const { challengeId } = await startRegistration()
    const res = await registerVerify({ challengeId, credential: { id: 'cred-alice-1' } })
    expect(ctx.verifier.calls.registrationOptions[0]?.userId).toBe(
      bodyOf<RegisterBody>(res).user.id
    )
  })

  // Caso 4
  it('un challenge inexistente → 400 CHALLENGE_EXPIRED y no crea nada', async () => {
    const res = await registerVerify({
      challengeId: 'chl_NOPE',
      credential: { id: 'cred-1' }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
    expect(await ctx.users.getCredential('cred-1')).toBeNull()
  })

  it('un challenge ya usado → 400 CHALLENGE_EXPIRED', async () => {
    const { challengeId } = await startRegistration()
    expect(
      (await registerVerify({ challengeId, credential: { id: 'cred-1' } })).status
    ).toBe(201)
    const again = await registerVerify({ challengeId, credential: { id: 'cred-2' } })
    expect(again.status).toBe(400)
    expect(errorOf(again).code).toBe('CHALLENGE_EXPIRED')
    expect(await ctx.users.getCredential('cred-2')).toBeNull()
  })

  it('un challenge de login no sirve para registrarse', async () => {
    const login = await request(ctx.app).post('/api/v1/auth/login/options')
    const res = await registerVerify({
      challengeId: bodyOf<OptionsBody>(login).challengeId,
      credential: { id: 'cred-1' }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
  })

  // Caso 5
  it('verificación de WebAuthn fallida → 400 PASSKEY_VERIFICATION_FAILED, nada creado y challenge gastado', async () => {
    const { challengeId } = await startRegistration()
    const res = await registerVerify({
      challengeId,
      credential: { id: 'cred-bad', ok: false }
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('PASSKEY_VERIFICATION_FAILED')
    expect(await ctx.users.getCredential('cred-bad')).toBeNull()
    expect(await ctx.users.findUserByWallet(wallet('alice').id)).toBeNull()

    const retry = await registerVerify({ challengeId, credential: { id: 'cred-bad' } })
    expect(errorOf(retry).code).toBe('CHALLENGE_EXPIRED')
  })

  // Caso 6 (carrera entre dos registros de la misma wallet)
  it('dos registros pendientes de la misma wallet: solo el primero se crea, el otro 409', async () => {
    const first = await startRegistration()
    const second = await startRegistration()
    expect(
      (
        await registerVerify({
          challengeId: first.challengeId,
          credential: { id: 'cred-1' }
        })
      ).status
    ).toBe(201)

    const res = await registerVerify({
      challengeId: second.challengeId,
      credential: { id: 'cred-2' }
    })
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('WALLET_ALREADY_REGISTERED')
    expect(await ctx.users.getCredential('cred-2')).toBeNull()
  })

  // Caso 13
  it('dos verificaciones en paralelo con el mismo challenge: solo una tiene éxito', async () => {
    const { challengeId } = await startRegistration()
    const [a, b] = await Promise.all([
      registerVerify({ challengeId, credential: { id: 'cred-a' } }),
      registerVerify({ challengeId, credential: { id: 'cred-b' } })
    ])
    expect([a.status, b.status].sort()).toEqual([201, 400])
    const created = [
      await ctx.users.getCredential('cred-a'),
      await ctx.users.getCredential('cred-b')
    ]
    expect(created.filter((c) => c !== null)).toHaveLength(1)
  })

  it.each([
    ['sin challengeId', { credential: { id: 'x' } }],
    ['sin credential', { challengeId: 'chl_X' }],
    ['con credential sin id', { challengeId: 'chl_X', credential: {} }],
    [
      'con campos desconocidos',
      { challengeId: 'chl_X', credential: { id: 'x' }, extra: 1 }
    ]
  ])('rechaza el body %s con 400 VALIDATION_ERROR', async (_name, body) => {
    const res = await registerVerify(body)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })
})
