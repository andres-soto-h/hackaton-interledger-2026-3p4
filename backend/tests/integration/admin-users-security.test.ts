import { beforeEach, describe, expect, it } from 'vitest'
import { call, ORIGIN, SIGNING_KEY } from '../helpers/admin.js'
import { signJwtWithKey } from '../helpers/jwt.js'
import {
  buildAdminUsersHarness,
  enrollTokenOf,
  getAs,
  loginAdmin,
  postAs,
  type AdminUsersHarness
} from '../helpers/admin-users.js'
import type { AdminSession } from '../helpers/admin.js'

const ID = 'usr_01JZZZZZZZZZZZZZZZZZZZZZZZ'

let h: AdminUsersHarness
let admin: AdminSession
beforeEach(async () => {
  h = buildAdminUsersHarness({ withPorts: true })
  admin = await loginAdmin(h)
})

const GETS = [
  '/admin/users',
  '/admin/users/new',
  `/admin/users/${ID}`,
  `/admin/users/${ID}/edit`
]
const POSTS: [string, Record<string, string>][] = [
  [
    '/admin/users',
    { displayName: 'X', walletAddress: '$ilp.interledger-test.dev/carla' }
  ],
  [`/admin/users/${ID}`, { displayName: 'X', walletAddress: 'w', status: 'ACTIVE' }],
  [`/admin/users/${ID}/delete`, { confirm: 'yes' }],
  [`/admin/users/${ID}/reset-access`, { credentialId: 'all' }],
  [`/admin/users/${ID}/revoke-wallet-link`, {}]
]

// Caso 10: protección de rutas.
describe('sin sesión de administrador', () => {
  it.each(GETS)('GET %s redirige al login', async (path) => {
    const res = await call(h.app, 'get', path)
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
  })

  it.each(POSTS)('POST %s redirige al login y no cambia nada', async (path, form) => {
    const res = await call(h.app, 'post', path)
      .type('form')
      .set('origin', ORIGIN)
      .send(form)
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/admin/login')
    expect(await h.users.listUsers()).toEqual([])
  })

  it('una cookie con otra clave de firma no sirve', async () => {
    const forged = signJwtWithKey('another-key-another-key-another-key', {
      aud: 'tranqui-admin',
      exp: Math.floor(Date.now() / 1000) + 600
    })
    const res = await call(h.app, 'get', '/admin/users').set(
      'cookie',
      `tranqui_admin=${forged}`
    )
    expect(res.status).toBe(302)
  })

  it('un JWT de usuario de la app no abre el panel', async () => {
    const { token } = await h.seedUser()
    const res = await call(h.app, 'get', '/admin/users').set(
      'cookie',
      `tranqui_admin=${token}`
    )
    expect(res.status).toBe(302)
  })

  it('la API key no sustituye a la sesión de administrador', async () => {
    const res = await call(h.app, 'get', '/admin/users').set('x-api-key', 'test-api-key')
    expect(res.status).toBe(302)
  })

  it('con el panel deshabilitado responde 404', async () => {
    const off = buildAdminUsersHarness({ enabled: false })
    const forged = signJwtWithKey(SIGNING_KEY, {
      aud: 'tranqui-admin',
      exp: Math.floor(Date.now() / 1000) + 600
    })
    const res = await call(off.app, 'get', '/admin/users').set(
      'cookie',
      `tranqui_admin=${forged}`
    )
    expect(res.status).toBe(404)
  })
})

describe('con sesión pero sin CSRF válido', () => {
  it.each(POSTS)('POST %s sin _csrf → 403 y sin cambios', async (path, form) => {
    const { user } = await h.seedUser()
    const target = path.replace(ID, user.id)
    const res = await postAs(h, admin, target, form, { csrf: null })
    expect(res.status).toBe(403)
    expect(await h.users.getUser(user.id)).toMatchObject({
      displayName: 'Alice',
      status: 'ACTIVE'
    })
    expect(await h.users.listUsers()).toHaveLength(1)
  })

  it.each(POSTS)('POST %s con _csrf falso → 403', async (path, form) => {
    const { user } = await h.seedUser()
    const res = await postAs(h, admin, path.replace(ID, user.id), form, {
      csrf: 'f'.repeat(64)
    })
    expect(res.status).toBe(403)
  })

  it.each(POSTS)('POST %s desde otro origen → 403', async (path, form) => {
    const { user } = await h.seedUser()
    const res = await postAs(h, admin, path.replace(ID, user.id), form, {
      origin: 'https://evil.example'
    })
    expect(res.status).toBe(403)
    expect(await h.users.listUsers()).toHaveLength(1)
  })
})

// Caso 8: auditoría.
describe('eventos de auditoría', () => {
  it('cada acción registra su evento con el ID del usuario y sin datos sensibles', async () => {
    const created = await postAs(h, admin, '/admin/users', {
      displayName: 'Carla',
      walletAddress: '$ilp.interledger-test.dev/carla'
    })
    const token = enrollTokenOf(created.text)
    const carla = await h.users.findUserByWallet('https://ilp.interledger-test.dev/carla')
    const id = carla?.id ?? ''

    const base = { displayName: 'Carla', walletAddress: carla?.walletAddress ?? '' }
    await postAs(h, admin, `/admin/users/${id}`, {
      ...base,
      displayName: 'Carla M',
      status: 'ACTIVE'
    })
    await postAs(h, admin, `/admin/users/${id}`, {
      ...base,
      displayName: 'Carla M',
      status: 'BLOCKED'
    })
    const reset = await postAs(h, admin, `/admin/users/${id}/reset-access`, {
      credentialId: 'all'
    })
    await postAs(h, admin, `/admin/users/${id}/delete`, { confirm: 'yes' })

    const all = (await h.activityLog.list({ limit: 100 })).items.filter((e) =>
      e.type.startsWith('user.')
    )
    expect(all.map((e) => e.type).sort()).toEqual([
      'user.access_reset',
      'user.blocked',
      'user.created',
      'user.deleted',
      'user.updated'
    ])
    for (const event of all) {
      expect(event.data.userId).toBe(id)
      expect(event.message.length).toBeGreaterThan(0)
    }
    const dump = JSON.stringify(all)
    expect(dump).not.toContain(token)
    expect(dump).not.toContain(enrollTokenOf(reset.text))
    expect(dump).not.toContain('enroll?token')
    expect(dump).not.toContain('cred-')
  })

  it('una acción rechazada no deja evento', async () => {
    await postAs(h, admin, '/admin/users', { displayName: '', walletAddress: '' })
    await postAs(h, admin, `/admin/users/${ID}/delete`, { confirm: 'yes' })
    const events = (await h.activityLog.list({ limit: 100 })).items.filter((e) =>
      e.type.startsWith('user.')
    )
    expect(events).toEqual([])
  })

  it('el panel de usuarios solo se navega con GET sin efectos', async () => {
    const { user } = await h.seedUser()
    await getAs(h, admin, '/admin/users')
    await getAs(h, admin, `/admin/users/${user.id}`)
    await getAs(h, admin, `/admin/users/${user.id}/edit`)
    expect(await h.users.getUser(user.id)).toMatchObject({ status: 'ACTIVE' })
    expect(
      (await h.activityLog.list({ limit: 100 })).items.filter((e) =>
        e.type.startsWith('user.')
      )
    ).toEqual([])
  })
})
