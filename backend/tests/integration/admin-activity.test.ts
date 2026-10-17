import { beforeEach, describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../src/shared/activity/activity-log.js'
import { bodyOf } from '../helpers/body.js'
import { call } from '../helpers/admin.js'
import {
  buildActivityHarness,
  getAs,
  loginAdmin,
  type ActivityHarness
} from '../helpers/admin-activity.js'
import type { AdminSession } from '../helpers/admin.js'

interface FeedBody {
  items: ActivityEvent[]
  nextCursor?: string
}

let h: ActivityHarness
let admin: AdminSession
beforeEach(async () => {
  h = buildActivityHarness()
  admin = await loginAdmin(h)
})

const feed = (query = '') => getAs(h, admin, `/admin/activity/feed${query}`)
const record = async (
  type: string,
  extra: { level?: 'info' | 'warn' | 'error'; paymentId?: string; message?: string } = {}
) => {
  h.clock.ms += 1000
  return h.activityLog.record({ type, message: extra.message ?? type, ...extra })
}

// Caso 5
describe('GET /admin/activity/feed', () => {
  it('sin cursor devuelve los eventos y un cursor; con cursor, solo los nuevos', async () => {
    await record('payment.quoted')
    await record('payment.confirmed')
    const first = bodyOf<FeedBody>(await feed())
    expect(first.items.map((e) => e.type)).toEqual([
      'payment.quoted',
      'payment.confirmed'
    ])
    expect(first.nextCursor).toBeTruthy()

    await record('payment.outgoing_created')
    const second = bodyOf<FeedBody>(
      await feed(`?after=${encodeURIComponent(first.nextCursor ?? '')}`)
    )
    expect(second.items.map((e) => e.type)).toEqual(['payment.outgoing_created'])
  })

  it('sin eventos nuevos devuelve una lista vacía y conserva el cursor', async () => {
    await record('payment.quoted')
    const first = bodyOf<FeedBody>(await feed())
    const again = bodyOf<FeedBody>(
      await feed(`?after=${encodeURIComponent(first.nextCursor ?? '')}`)
    )
    expect(again.items).toEqual([])
    expect(again.nextCursor).toBe(first.nextCursor)
  })

  it('filtra por paymentId, tipo y nivel', async () => {
    await record('payment.quoted', { paymentId: 'pay_A' })
    await record('payment.cancelled', { paymentId: 'pay_A', level: 'warn' })
    await record('payment.quoted', { paymentId: 'pay_B' })
    const typesOf = async (query: string) =>
      bodyOf<FeedBody>(await feed(query)).items.map((e) => `${e.type}:${e.paymentId}`)

    expect(await typesOf('?paymentId=pay_A')).toEqual([
      'payment.quoted:pay_A',
      'payment.cancelled:pay_A'
    ])
    expect(await typesOf('?type=payment.quoted')).toEqual([
      'payment.quoted:pay_A',
      'payment.quoted:pay_B'
    ])
    expect(await typesOf('?level=warn')).toEqual(['payment.cancelled:pay_A'])
  })

  it('devuelve como máximo 100 eventos por llamada y se continúa con el cursor', async () => {
    for (let i = 0; i < 120; i += 1) await record('payment.quoted')
    const first = bodyOf<FeedBody>(await feed())
    expect(first.items).toHaveLength(100)
    const rest = bodyOf<FeedBody>(
      await feed(`?after=${encodeURIComponent(first.nextCursor ?? '')}`)
    )
    expect(rest.items).toHaveLength(20)
    expect(new Set([...first.items, ...rest.items].map((e) => e.id)).size).toBe(120)
  })

  it('un nivel o un cursor inválidos → 400 VALIDATION_ERROR', async () => {
    expect((await feed('?level=debug')).status).toBe(400)
    expect((await feed('?after=!!!')).status).toBe(400)
  })

  it('responde con Cache-Control: no-store', async () => {
    expect((await feed()).headers['cache-control']).toBe('no-store')
  })
})

describe('GET /admin/activity (página)', () => {
  it('es HTML con script propio, sin scripts en línea y con los filtros', async () => {
    const res = await getAs(h, admin, '/admin/activity')
    expect(res.status).toBe(200)
    expect(res.text).toContain('/admin/assets/activity.js')
    expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)
    for (const field of ['paymentId', 'type', 'level']) {
      expect(res.text).toContain(`name="${field}"`)
    }
    expect(res.headers['content-security-policy']).toContain("script-src 'self'")
  })

  it('el script consulta el feed, usa textContent, nunca innerHTML y se pausa', async () => {
    const res = await call(h.app, 'get', '/admin/assets/activity.js')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/javascript/)
    expect(res.text).toContain('/admin/activity/feed')
    expect(res.text).toContain('textContent')
    expect(res.text).not.toContain('innerHTML')
    expect(res.text).toContain('visibilityState')
    expect(res.text).toContain('2000')
  })
})

// Caso 6
describe('páginas de pagos', () => {
  it('lista los pagos con su estado, más recientes primero, y filtra por estado', async () => {
    await h.seedPayment({
      id: 'pay_01JC00000000000000000000A1',
      createdAt: '2026-10-17T10:01:00.000Z'
    })
    await h.seedPayment({
      id: 'pay_01JC00000000000000000000A2',
      createdAt: '2026-10-17T10:02:00.000Z',
      status: 'COMPLETED'
    })
    const all = await getAs(h, admin, '/admin/payments')
    expect(all.status).toBe(200)
    expect(all.text.indexOf('pay_01JC00000000000000000000A2')).toBeGreaterThan(-1)
    expect(all.text.indexOf('pay_01JC00000000000000000000A2')).toBeLessThan(
      all.text.indexOf('pay_01JC00000000000000000000A1')
    )
    const completed = await getAs(h, admin, '/admin/payments?status=COMPLETED')
    expect(completed.text).toContain('pay_01JC00000000000000000000A2')
    expect(completed.text).not.toContain('pay_01JC00000000000000000000A1')
  })

  it('el detalle muestra los datos del pago y su línea de tiempo en orden', async () => {
    const payment = await h.seedPayment({ description: '<img src=x onerror=alert(1)>' })
    await record('payment.quoted', { paymentId: payment.id, message: 'Quote creado' })
    await record('payment.confirmed', { paymentId: payment.id, message: 'Confirmado' })
    await record('payment.outgoing_created', {
      paymentId: payment.id,
      message: 'Outgoing creado'
    })
    await record('payment.quoted', { paymentId: 'pay_other', message: 'Ajeno' })

    const res = await getAs(h, admin, `/admin/payments/${payment.id}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain(payment.id)
    expect(res.text).toContain('AWAITING_CONFIRMATION')
    const order = ['Quote creado', 'Confirmado', 'Outgoing creado'].map((m) =>
      res.text.indexOf(m)
    )
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(res.text).not.toContain('Ajeno')
    expect(res.text).not.toContain('<img src=x')
    expect(res.text).toContain('&lt;img')
  })

  it('un pago inexistente → 404', async () => {
    const res = await getAs(h, admin, '/admin/payments/pay_01JC00000000000000000000ZZ')
    expect(res.status).toBe(404)
  })
})

// Caso 7
describe('protección de rutas', () => {
  it.each(['/admin/activity', '/admin/payments', '/admin/payments/pay_x'])(
    'las páginas %s sin sesión → 302 al login',
    async (path) => {
      const res = await call(h.app, 'get', path)
      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('/admin/login')
    }
  )

  it('el feed sin sesión → 401 JSON, sin eventos', async () => {
    await record('payment.quoted')
    const res = await call(h.app, 'get', '/admin/activity/feed')
    expect(res.status).toBe(401)
    expect(JSON.stringify(res.body)).not.toContain('payment.quoted')
  })

  it('con el panel deshabilitado todas las rutas responden 404', async () => {
    const off = buildActivityHarness({ enabled: false })
    for (const path of ['/admin/activity', '/admin/activity/feed', '/admin/payments']) {
      expect((await call(off.app, 'get', path)).status).toBe(404)
    }
  })

  it('las respuestas llevan las cabeceras de seguridad del panel', async () => {
    const res = await getAs(h, admin, '/admin/activity')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
