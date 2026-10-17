import { beforeEach, describe, expect, it } from 'vitest'
import { wallet } from '../helpers/auth-context.js'
import {
  buildAdminUsersHarness,
  getAs,
  loginAdmin,
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

const idsIn = (page: string): string[] =>
  [...page.matchAll(/href="\/admin\/users\/(usr_[0-9A-Z]{26})"/g)].map((m) => m[1] ?? '')
const cursorIn = (page: string): string | undefined =>
  /cursor=([A-Za-z0-9_-]+)/.exec(page)?.[1]

// Caso 1: lista, búsqueda y paginación.
describe('GET /admin/users', () => {
  it('sin usuarios muestra la tabla vacía', async () => {
    const res = await getAs(h, admin, '/admin/users')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/html/)
    expect(idsIn(res.text)).toEqual([])
    expect(cursorIn(res.text)).toBeUndefined()
  })

  it('con 5 usuarios los lista todos en una página, el más nuevo primero', async () => {
    const created: string[] = []
    for (let i = 0; i < 5; i++) {
      const seeded = await h.seedUser(
        {
          displayName: `Usuario ${i}`,
          walletAddress: `https://ilp.interledger-test.dev/u${i}`,
          createdAt: new Date(START_MS + i * 60_000).toISOString()
        },
        null
      )
      created.push(seeded.user.id)
    }
    const res = await getAs(h, admin, '/admin/users')
    expect(idsIn(res.text)).toEqual([...created].reverse())
    expect(cursorIn(res.text)).toBeUndefined()
  })

  it('con 30 usuarios pagina de a 20 y el cursor lleva a los 10 restantes', async () => {
    const created: string[] = []
    for (let i = 0; i < 30; i++) {
      const seeded = await h.seedUser(
        {
          displayName: `Usuario ${String(i).padStart(2, '0')}`,
          walletAddress: `https://ilp.interledger-test.dev/u${i}`,
          createdAt: new Date(START_MS + i * 60_000).toISOString()
        },
        null
      )
      created.push(seeded.user.id)
    }
    const first = await getAs(h, admin, '/admin/users')
    expect(idsIn(first.text)).toHaveLength(20)
    const cursor = cursorIn(first.text)
    expect(cursor).toBeDefined()

    const second = await getAs(h, admin, `/admin/users?cursor=${cursor ?? ''}`)
    expect(idsIn(second.text)).toHaveLength(10)
    expect(cursorIn(second.text)).toBeUndefined()
    expect([...idsIn(first.text), ...idsIn(second.text)].sort()).toEqual(
      [...created].sort()
    )
  })

  it('busca por nombre (sin distinguir mayúsculas) y por wallet', async () => {
    const ana = await h.seedUser(
      { displayName: 'Ana Gómez', walletAddress: wallet('bob').id },
      null
    )
    await h.seedUser({ displayName: 'Luis', walletAddress: wallet('carla').id }, null)

    const byName = await getAs(h, admin, '/admin/users?q=ana')
    expect(idsIn(byName.text)).toEqual([ana.user.id])

    const byWallet = await getAs(h, admin, '/admin/users?q=interledger-test.dev/carla')
    expect(idsIn(byWallet.text)).toHaveLength(1)
    expect(byWallet.text).toContain('Luis')

    const none = await getAs(h, admin, '/admin/users?q=nadie')
    expect(idsIn(none.text)).toEqual([])
  })

  it('la búsqueda se conserva en el enlace de la página siguiente', async () => {
    for (let i = 0; i < 25; i++) {
      await h.seedUser(
        {
          displayName: `Cliente ${i}`,
          walletAddress: `https://ilp.interledger-test.dev/c${i}`,
          createdAt: new Date(START_MS + i * 1000).toISOString()
        },
        null
      )
    }
    const res = await getAs(h, admin, '/admin/users?q=cliente')
    expect(idsIn(res.text)).toHaveLength(20)
    expect(res.text).toMatch(/q=cliente/)
    expect(cursorIn(res.text)).toBeDefined()
  })

  it('un cursor corrupto responde 400', async () => {
    const res = await getAs(h, admin, '/admin/users?cursor=no-es-un-cursor')
    expect(res.status).toBe(400)
  })

  it('el menú del panel enlaza a Usuarios', async () => {
    const res = await getAs(h, admin, '/admin/users')
    expect(res.text).toContain('href="/admin/users"')
  })

  it('usa las cabeceras de seguridad del panel', async () => {
    const res = await getAs(h, admin, '/admin/users')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })
})

// Caso 9: escape de HTML.
describe('escape de HTML en lista y detalle', () => {
  const XSS = '<script>alert(1)</script>'

  it('muestra el nombre escapado en la lista y en el detalle', async () => {
    const { user } = await h.seedUser({ displayName: XSS })
    const list = await getAs(h, admin, '/admin/users')
    expect(list.text).not.toContain(XSS)
    expect(list.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

    const detail = await getAs(h, admin, `/admin/users/${user.id}`)
    expect(detail.text).not.toContain(XSS)
    expect(detail.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapa también la búsqueda que se refleja en la página', async () => {
    const res = await getAs(h, admin, `/admin/users?q=${encodeURIComponent(XSS)}`)
    expect(res.text).not.toContain(XSS)
  })
})

describe('GET /admin/users/{id}', () => {
  it('muestra los datos, los passkeys y no expone la llave pública', async () => {
    const { user } = await h.seedUser(
      { displayName: 'Alice' },
      {
        publicKey: 'SECRET-PUBLIC-KEY-MATERIAL',
        lastUsedAt: new Date(START_MS + 5 * 60_000).toISOString(),
        backedUp: true
      }
    )
    const res = await getAs(h, admin, `/admin/users/${user.id}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Alice')
    expect(res.text).toContain(user.walletAddress)
    expect(res.text).toContain('ACTIVE')
    expect(res.text).toMatch(/Sincronizado/i)
    expect(res.text).toMatch(/Último uso/i)
    expect(res.text).not.toContain('SECRET-PUBLIC-KEY-MATERIAL')
  })

  it('con los puertos opcionales muestra la vinculación y los últimos pagos', async () => {
    const { user } = await h.seedUser()
    h.walletLinks.summaries.set(user.id, {
      status: 'ACTIVE',
      dailyLimit: '200.00',
      spentToday: '35.50',
      assetCode: 'USD'
    })
    h.payments.byWallet.set(user.walletAddress, [
      {
        id: 'pay_01JZZZZZZZZZZZZZZZZZZZZZZZ',
        status: 'COMPLETED',
        amount: '12.00',
        assetCode: 'USD',
        createdAt: new Date(START_MS).toISOString()
      }
    ])
    const res = await getAs(h, admin, `/admin/users/${user.id}`)
    expect(res.text).toContain('200.00')
    expect(res.text).toContain('35.50')
    expect(res.text).toContain('pay_01JZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(res.text).toContain('COMPLETED')
  })

  it('sin vinculación indica que no hay wallet vinculada', async () => {
    const { user } = await h.seedUser()
    const res = await getAs(h, admin, `/admin/users/${user.id}`)
    expect(res.text).toMatch(/sin vincular|no vinculada/i)
  })

  it('un usuario inexistente responde 404', async () => {
    const res = await getAs(h, admin, '/admin/users/usr_01JZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(res.status).toBe(404)
  })
})
