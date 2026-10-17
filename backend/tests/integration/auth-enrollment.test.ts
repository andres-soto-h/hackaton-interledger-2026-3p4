import { createHash } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { User } from '../../src/modules/users/user.types.js'
import { newUserId } from '../../src/shared/ids/ids.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf } from '../helpers/errors.js'
import {
  buildAuthContext,
  START,
  wallet,
  type AuthContext
} from '../helpers/auth-context.js'

interface OptionsBody {
  challengeId: string
  options: { challenge: string }
}
interface RegisterBody {
  user: { id: string; displayName: string; walletAddress: string }
  session: { token: string; expiresAt: string }
}

const TOKEN = 'e'.repeat(64)
const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')

let ctx: AuthContext
let user: User
beforeEach(async () => {
  ctx = buildAuthContext()
  user = {
    id: newUserId(START),
    displayName: 'Carla',
    walletAddress: wallet('alice').id,
    walletAssetCode: 'USD',
    status: 'ACTIVE',
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString()
  }
  await ctx.users.createUser(user)
  await ctx.users.createEnrollment({
    tokenHash: hashOf(TOKEN),
    userId: user.id,
    expiresAt: START / 1000 + 86_400
  })
})

const options = (body: unknown) =>
  request(ctx.app)
    .post('/api/v1/auth/register/options')
    .send(body as object)
const verify = (body: unknown) =>
  request(ctx.app)
    .post('/api/v1/auth/register/verify')
    .send(body as object)

const start = async (token = TOKEN) => {
  const res = await options({ enrollmentToken: token })
  expect(res.status).toBe(200)
  return bodyOf<OptionsBody>(res)
}

// Caso 3 (spec 021): registro de passkey con enlace.
describe('POST /api/v1/auth/register/options con enrollmentToken', () => {
  it('devuelve opciones para la cuenta existente y no consume el enlace', async () => {
    const body = await start()
    expect(body.challengeId).toMatch(/^chl_/)
    expect(ctx.verifier.calls.registrationOptions[0]).toMatchObject({
      userId: user.id,
      userName: 'Carla'
    })
    expect(await ctx.users.getEnrollment(hashOf(TOKEN), START / 1000)).not.toBeNull()
  })

  it.each([
    ['desconocido', 'f'.repeat(64)],
    ['con formato inválido', 'corto']
  ])(
    'un enlace %s responde 400 CHALLENGE_EXPIRED o VALIDATION_ERROR',
    async (_n, token) => {
      const res = await options({ enrollmentToken: token })
      expect(res.status).toBe(400)
      expect(['CHALLENGE_EXPIRED', 'VALIDATION_ERROR']).toContain(errorOf(res).code)
    }
  )

  it('un enlace vencido (más de 24 h) responde 400 CHALLENGE_EXPIRED', async () => {
    ctx.clock.advanceSeconds(86_401)
    const res = await options({ enrollmentToken: TOKEN })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
  })

  it('un usuario bloqueado no puede registrar un passkey', async () => {
    await ctx.users.setUserStatus(user.id, 'BLOCKED', user.updatedAt)
    const res = await options({ enrollmentToken: TOKEN })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
  })

  it('no admite el token junto con displayName o walletAddress', async () => {
    const res = await options({
      enrollmentToken: TOKEN,
      displayName: 'Mallory',
      walletAddress: '$ilp.interledger-test.dev/bob'
    })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('VALIDATION_ERROR')
  })

  it('sigue admitiendo el registro normal sin token', async () => {
    const res = await options({
      displayName: 'Bob',
      walletAddress: '$ilp.interledger-test.dev/bob'
    })
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/auth/register/verify con enrollmentToken', () => {
  it('asocia el passkey a la cuenta existente, devuelve su sesión y consume el enlace', async () => {
    const { challengeId } = await start()
    const res = await verify({ challengeId, credential: { id: 'cred-enroll-1' } })
    expect(res.status).toBe(201)
    const body = bodyOf<RegisterBody>(res)
    expect(body.user.id).toBe(user.id)
    expect(body.user.walletAddress).toBe(user.walletAddress)

    const credentials = await ctx.users.listCredentials(user.id)
    expect(credentials.map((c) => c.id)).toEqual(['cred-enroll-1'])
    expect(await ctx.users.getEnrollment(hashOf(TOKEN), START / 1000)).toBeNull()
    expect((await options({ enrollmentToken: TOKEN })).status).toBe(400)

    const me = await request(ctx.app)
      .get('/api/v1/me')
      .set('authorization', `Bearer ${body.session.token}`)
    expect(me.status).toBe(200)
  })

  it('no crea un usuario nuevo ni toca la unicidad de la wallet', async () => {
    const { challengeId } = await start()
    await verify({ challengeId, credential: { id: 'cred-enroll-1' } })
    expect((await ctx.users.listUsers()).map((u) => u.id)).toEqual([user.id])
    expect((await ctx.users.findUserByWallet(user.walletAddress))?.id).toBe(user.id)
  })

  it('la sesión emitida lleva la sessionVersion actual del usuario', async () => {
    await ctx.users.bumpSessionVersion(user.id, user.updatedAt)
    await ctx.users.bumpSessionVersion(user.id, user.updatedAt)
    const { challengeId } = await start()
    const res = await verify({ challengeId, credential: { id: 'cred-enroll-1' } })
    expect(
      ctx.sessions.verify(bodyOf<RegisterBody>(res).session.token).sessionVersion
    ).toBe(2)
  })

  it('un enlace invalidado por un restablecimiento posterior ya no sirve', async () => {
    const { challengeId } = await start()
    await ctx.users.deleteEnrollments(user.id)
    const res = await verify({ challengeId, credential: { id: 'cred-enroll-1' } })
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CHALLENGE_EXPIRED')
    expect(await ctx.users.listCredentials(user.id)).toEqual([])
  })

  it('con dos intentos en paralelo solo uno registra su passkey', async () => {
    const first = await start()
    const second = await start()
    const results = await Promise.all([
      verify({ challengeId: first.challengeId, credential: { id: 'cred-a' } }),
      verify({ challengeId: second.challengeId, credential: { id: 'cred-b' } })
    ])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
    expect(await ctx.users.listCredentials(user.id)).toHaveLength(1)
  })

  it('si el passkey no verifica, el enlace sigue sirviendo', async () => {
    const { challengeId } = await start()
    const bad = await verify({ challengeId, credential: { id: 'cred-x', ok: false } })
    expect(bad.status).toBe(400)
    expect(errorOf(bad).code).toBe('PASSKEY_VERIFICATION_FAILED')
    expect(await ctx.users.getEnrollment(hashOf(TOKEN), START / 1000)).not.toBeNull()

    const retry = await start()
    const ok = await verify({
      challengeId: retry.challengeId,
      credential: { id: 'cred-y' }
    })
    expect(ok.status).toBe(201)
  })
})
