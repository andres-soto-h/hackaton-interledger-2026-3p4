import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyOf } from '../helpers/body.js'
import { wallet } from '../helpers/auth-context.js'
import {
  buildAdminUsersHarness,
  ENROLL_URL,
  enrollTokenOf,
  getAs,
  loginAdmin,
  postAs,
  sha256Hex,
  START_MS,
  type AdminUsersHarness
} from '../helpers/admin-users.js'
import type { AdminSession } from '../helpers/admin.js'

let h: AdminUsersHarness
let admin: AdminSession
beforeEach(async () => {
  h = buildAdminUsersHarness({ withPorts: true })
  admin = await loginAdmin(h)
})

const nowSeconds = () => Math.floor(h.clock.ms / 1000)
const eventsOf = async (type: string) => (await h.activityLog.list({ type })).items
const me = (token: string) =>
  request(h.app).get('/api/v1/me').set('authorization', `Bearer ${token}`)

// Caso 2: crear.
describe('crear usuario', () => {
  it('GET /admin/users/new muestra el formulario con CSRF', async () => {
    const res = await getAs(h, admin, '/admin/users/new')
    expect(res.status).toBe(200)
    expect(res.text).toContain('name="displayName"')
    expect(res.text).toContain('name="walletAddress"')
    expect(res.text).toContain('name="_csrf"')
  })

  it('con datos válidos crea la cuenta sin passkey y muestra el enlace de registro una sola vez', async () => {
    const res = await postAs(h, admin, '/admin/users', {
      displayName: 'Carla',
      walletAddress: '$ilp.interledger-test.dev/carla'
    })
    expect(res.status).toBe(201)
    const token = enrollTokenOf(res.text)
    expect(token).toHaveLength(64)
    expect(res.text).toContain(`${ENROLL_URL}?token=${token}`)

    const created = await h.users.findUserByWallet(wallet('carla').id)
    expect(created).toMatchObject({
      displayName: 'Carla',
      status: 'ACTIVE',
      walletAssetCode: 'USD'
    })
    expect(await h.users.listCredentials(created?.id ?? '')).toEqual([])

    // Solo se guarda el hash y vence en 24 h.
    const stored = await h.users.getEnrollment(sha256Hex(token), nowSeconds())
    expect(stored).toEqual({
      tokenHash: sha256Hex(token),
      userId: created?.id,
      expiresAt: nowSeconds() + 86_400
    })

    // El detalle no vuelve a mostrar el enlace.
    const detail = await getAs(h, admin, `/admin/users/${created?.id ?? ''}`)
    expect(enrollTokenOf(detail.text)).toBe('')
  })

  it('acepta la wallet como URL https completa', async () => {
    const res = await postAs(h, admin, '/admin/users', {
      displayName: 'Diana',
      walletAddress: wallet('diana').id
    })
    expect(res.status).toBe(201)
  })

  it('con una wallet ya registrada devuelve el formulario con el error y no crea nada', async () => {
    await h.seedUser()
    const res = await postAs(h, admin, '/admin/users', {
      displayName: 'Otra Alice',
      walletAddress: '$ilp.interledger-test.dev/alice'
    })
    expect(res.status).toBe(422)
    expect(res.text).toMatch(/ya está registrada/i)
    expect(res.text).toContain('Otra Alice')
    expect(await h.users.listUsers()).toHaveLength(1)
    expect(await eventsOf('user.created')).toEqual([])
  })

  it('con una wallet inexistente devuelve el formulario con el error', async () => {
    const res = await postAs(h, admin, '/admin/users', {
      displayName: 'Nadie',
      walletAddress: '$ilp.interledger-test.dev/no-existe'
    })
    expect(res.status).toBe(422)
    expect(res.text).toMatch(/no se encontró|no existe/i)
    expect(await h.users.listUsers()).toEqual([])
  })

  it.each([
    ['host no permitido', 'https://evil.example/alice'],
    ['esquema http', 'http://ilp.interledger-test.dev/alice'],
    ['IP interna', 'https://169.254.169.254/latest']
  ])('rechaza la wallet con %s sin llamar a Open Payments', async (_n, walletAddress) => {
    const res = await postAs(h, admin, '/admin/users', {
      displayName: 'X',
      walletAddress
    })
    expect(res.status).toBe(422)
    expect(await h.users.listUsers()).toEqual([])
  })

  it.each([
    ['sin nombre', { displayName: '', walletAddress: '$ilp.interledger-test.dev/carla' }],
    [
      'nombre de 61 caracteres',
      { displayName: 'a'.repeat(61), walletAddress: '$ilp.interledger-test.dev/carla' }
    ],
    ['sin wallet', { displayName: 'Carla', walletAddress: '' }]
  ])('rechaza el formulario %s', async (_n, form) => {
    const res = await postAs(h, admin, '/admin/users', form)
    expect(res.status).toBe(422)
    expect(await h.users.listUsers()).toEqual([])
  })
})

// Caso 4: editar.
describe('editar usuario', () => {
  it('cambia el nombre y la wallet y mueve la unicidad', async () => {
    const { user } = await h.seedUser()
    const res = await postAs(h, admin, `/admin/users/${user.id}`, {
      displayName: 'Alice B',
      walletAddress: '$ilp.interledger-test.dev/carla',
      status: 'ACTIVE'
    })
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe(`/admin/users/${user.id}`)
    const updated = await h.users.getUser(user.id)
    expect(updated).toMatchObject({
      displayName: 'Alice B',
      walletAddress: wallet('carla').id
    })
    expect(await h.users.findUserByWallet(wallet('alice').id)).toBeNull()
    expect((await h.users.findUserByWallet(wallet('carla').id))?.id).toBe(user.id)
    expect(await eventsOf('user.updated')).toHaveLength(1)
  })

  it('actualiza la moneda al cambiar a una wallet de otra moneda', async () => {
    const { user } = await h.seedUser()
    await postAs(h, admin, `/admin/users/${user.id}`, {
      displayName: 'Alice',
      walletAddress: '$ilp.interledger-test.dev/peso',
      status: 'ACTIVE'
    })
    expect((await h.users.getUser(user.id))?.walletAssetCode).toBe('MXN')
  })

  it('rechaza una wallet que ya pertenece a otro usuario', async () => {
    const { user } = await h.seedUser()
    await h.seedUser({ displayName: 'Bob', walletAddress: wallet('bob').id }, null)
    const res = await postAs(h, admin, `/admin/users/${user.id}`, {
      displayName: 'Alice',
      walletAddress: '$ilp.interledger-test.dev/bob',
      status: 'ACTIVE'
    })
    expect(res.status).toBe(422)
    expect(res.text).toMatch(/ya está registrada/i)
    expect((await h.users.getUser(user.id))?.walletAddress).toBe(wallet('alice').id)
  })

  it('sin cambios no genera evento', async () => {
    const { user } = await h.seedUser()
    await postAs(h, admin, `/admin/users/${user.id}`, {
      displayName: 'Alice',
      walletAddress: user.walletAddress,
      status: 'ACTIVE'
    })
    expect(await eventsOf('user.updated')).toEqual([])
  })

  it('el formulario de edición trae los datos actuales', async () => {
    const { user } = await h.seedUser({ displayName: 'Alice' })
    const res = await getAs(h, admin, `/admin/users/${user.id}/edit`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('value="Alice"')
    expect(res.text).toContain(user.walletAddress)
  })

  it('un usuario inexistente responde 404 al editar', async () => {
    const res = await postAs(h, admin, '/admin/users/usr_01JZZZZZZZZZZZZZZZZZZZZZZZ', {
      displayName: 'X',
      walletAddress: '$ilp.interledger-test.dev/carla',
      status: 'ACTIVE'
    })
    expect(res.status).toBe(404)
  })
})

// Caso 5: bloquear y desbloquear.
describe('bloquear y desbloquear', () => {
  const form = (user: { walletAddress: string }, status: string) => ({
    displayName: 'Alice',
    walletAddress: user.walletAddress,
    status
  })

  it('un usuario bloqueado pierde su sesión y no puede entrar; al desbloquear solo sirve una sesión nueva', async () => {
    const { user, token } = await h.seedUser()
    expect((await me(token)).status).toBe(200)

    const block = await postAs(h, admin, `/admin/users/${user.id}`, form(user, 'BLOCKED'))
    expect(block.status).toBe(302)
    expect((await h.users.getUser(user.id))?.status).toBe('BLOCKED')
    expect((await h.users.getUser(user.id))?.sessionVersion).toBe(1)
    expect((await me(token)).status).toBe(401)
    expect(await eventsOf('user.blocked')).toHaveLength(1)

    // El login con passkey también se rechaza.
    const options = await request(h.app).post('/api/v1/auth/login/options')
    const login = await request(h.app)
      .post('/api/v1/auth/login/verify')
      .send({
        challengeId: bodyOf<{ challengeId: string }>(options).challengeId,
        credential: { id: `cred-${user.id}`, newCounter: 1 }
      })
    expect(login.status).toBe(401)

    const unblock = await postAs(
      h,
      admin,
      `/admin/users/${user.id}`,
      form(user, 'ACTIVE')
    )
    expect(unblock.status).toBe(302)
    expect((await me(token)).status).toBe(401)
    const fresh = h.sessions.issue(user.id, 1).token
    expect((await me(fresh)).status).toBe(200)
    expect(await eventsOf('user.updated')).toHaveLength(1)
  })

  it('rechaza un estado desconocido', async () => {
    const { user } = await h.seedUser()
    const res = await postAs(h, admin, `/admin/users/${user.id}`, form(user, 'DELETED'))
    expect(res.status).toBe(422)
    expect((await h.users.getUser(user.id))?.status).toBe('ACTIVE')
  })
})

// Caso 7: borrar.
describe('borrar usuario', () => {
  it('borra usuario, passkeys y unicidad de la wallet; cancela la vinculación; no toca pagos', async () => {
    const { user, token } = await h.seedUser()
    h.walletLinks.summaries.set(user.id, { status: 'ACTIVE' })
    h.payments.byWallet.set(user.walletAddress, [
      { id: 'pay_1', status: 'COMPLETED', createdAt: new Date(START_MS).toISOString() }
    ])

    const res = await postAs(h, admin, `/admin/users/${user.id}/delete`, {
      confirm: 'yes'
    })
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/admin/users')

    expect(await h.users.getUser(user.id)).toBeNull()
    expect(await h.users.listCredentials(user.id)).toEqual([])
    expect(await h.users.findUserByWallet(user.walletAddress)).toBeNull()
    expect(h.walletLinks.revoked).toEqual([user.id])
    expect(h.payments.byWallet.get(user.walletAddress)).toHaveLength(1)
    expect((await me(token)).status).toBe(401)
    expect(await eventsOf('user.deleted')).toHaveLength(1)

    // La wallet queda libre para registrarse de nuevo.
    const again = await postAs(h, admin, '/admin/users', {
      displayName: 'Alice de nuevo',
      walletAddress: '$ilp.interledger-test.dev/alice'
    })
    expect(again.status).toBe(201)
  })

  it('sin confirmación no borra', async () => {
    const { user } = await h.seedUser()
    const res = await postAs(h, admin, `/admin/users/${user.id}/delete`, {})
    expect(res.status).toBe(422)
    expect(await h.users.getUser(user.id)).not.toBeNull()
    expect(await eventsOf('user.deleted')).toEqual([])
  })

  it('borrar un usuario inexistente responde 404', async () => {
    const res = await postAs(
      h,
      admin,
      '/admin/users/usr_01JZZZZZZZZZZZZZZZZZZZZZZZ/delete',
      {
        confirm: 'yes'
      }
    )
    expect(res.status).toBe(404)
  })
})

// Caso 6: restablecer acceso.
describe('restablecer acceso', () => {
  const seedWithTwoPasskeys = async () => {
    const seeded = await h.seedUser({}, { id: 'cred-a' })
    await h.users.addCredential({
      id: 'cred-b',
      userId: seeded.user.id,
      publicKey: 'pk-b',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: new Date(START_MS).toISOString()
    })
    return seeded
  }

  it('revoca todos los passkeys, corta las sesiones y genera un enlace nuevo', async () => {
    const { user, token } = await seedWithTwoPasskeys()
    const old = await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'all'
    })
    expect(old.status).toBe(200)
    const link = enrollTokenOf(old.text)
    expect(link).toHaveLength(64)
    expect(await h.users.listCredentials(user.id)).toEqual([])
    expect((await me(token)).status).toBe(401)
    expect(await h.users.getEnrollment(sha256Hex(link), nowSeconds())).toMatchObject({
      userId: user.id,
      expiresAt: nowSeconds() + 86_400
    })
    expect(await eventsOf('user.access_reset')).toHaveLength(1)
  })

  it('revocar un solo passkey deja el otro', async () => {
    const { user } = await seedWithTwoPasskeys()
    await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'cred-a'
    })
    expect((await h.users.listCredentials(user.id)).map((c) => c.id)).toEqual(['cred-b'])
  })

  it('un restablecimiento invalida los enlaces anteriores', async () => {
    const { user } = await seedWithTwoPasskeys()
    const first = await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'all'
    })
    const second = await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'all'
    })
    const a = enrollTokenOf(first.text)
    const b = enrollTokenOf(second.text)
    expect(a).not.toBe(b)
    expect(await h.users.getEnrollment(sha256Hex(a), nowSeconds())).toBeNull()
    expect(await h.users.getEnrollment(sha256Hex(b), nowSeconds())).not.toBeNull()
  })

  it('el usuario puede registrar un passkey nuevo con el enlace y vuelve a tener sesión', async () => {
    const { user } = await seedWithTwoPasskeys()
    const reset = await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'all'
    })
    const options = await request(h.app)
      .post('/api/v1/auth/register/options')
      .send({ enrollmentToken: enrollTokenOf(reset.text) })
    expect(options.status).toBe(200)
    const verified = await request(h.app)
      .post('/api/v1/auth/register/verify')
      .send({
        challengeId: bodyOf<{ challengeId: string }>(options).challengeId,
        credential: { id: 'cred-new' }
      })
    expect(verified.status).toBe(201)
    const session = bodyOf<{ session: { token: string } }>(verified).session.token
    expect((await me(session)).status).toBe(200)
  })

  it('un credentialId que no es del usuario no borra nada', async () => {
    const { user } = await seedWithTwoPasskeys()
    const other = await h.seedUser(
      { displayName: 'Bob', walletAddress: wallet('bob').id },
      { id: 'cred-bob' }
    )
    const res = await postAs(h, admin, `/admin/users/${user.id}/reset-access`, {
      credentialId: 'cred-bob'
    })
    expect(res.status).toBe(422)
    expect(await h.users.getCredential('cred-bob')).not.toBeNull()
    expect(await h.users.listCredentials(user.id)).toHaveLength(2)
    expect(other.user.id).not.toBe(user.id)
  })
})

describe('revocar la vinculación de la wallet', () => {
  it('cancela la vinculación pero conserva la cuenta y sus passkeys', async () => {
    const { user } = await h.seedUser()
    h.walletLinks.summaries.set(user.id, { status: 'ACTIVE' })
    const res = await postAs(h, admin, `/admin/users/${user.id}/revoke-wallet-link`)
    expect(res.status).toBe(302)
    expect(h.walletLinks.revoked).toEqual([user.id])
    expect(await h.users.getUser(user.id)).not.toBeNull()
    expect(await h.users.listCredentials(user.id)).toHaveLength(1)
  })
})
