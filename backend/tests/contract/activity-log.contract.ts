import { beforeEach, describe, expect, it } from 'vitest'
import type { ActivityLog } from '../../src/shared/activity/activity-log.js'

const DAY_SECONDS = 86_400

interface Harness {
  log: ActivityLog
  /** Moves the clock the implementation under test reads. */
  advance(ms: number): void
  nowMs(): number
}

/** Contract every `ActivityLog` implementation must pass (casos 14 y 15 del spec 020). */
export function runActivityLogContract(name: string, make: () => Harness): void {
  describe(`ActivityLog (${name})`, () => {
    let h: Harness
    beforeEach(() => {
      h = make()
    })

    it('guarda un evento con id evt_, fecha ISO, nivel por defecto info y TTL de 7 días', async () => {
      const event = await h.log.record({
        type: 'payment.quoted',
        paymentId: 'pay_1',
        requestId: 'req-1',
        message: 'Quote: 25.07 USD'
      })
      expect(event.id).toMatch(/^evt_[0-9A-Z]{26}$/)
      expect(event.createdAt).toBe(new Date(h.nowMs()).toISOString())
      expect(event).toMatchObject({
        level: 'info',
        type: 'payment.quoted',
        paymentId: 'pay_1',
        requestId: 'req-1',
        message: 'Quote: 25.07 USD'
      })
      expect(event.expiresAt).toBe(Math.floor(h.nowMs() / 1000) + 7 * DAY_SECONDS)
    })

    it('lista en orden de llegada y devuelve un cursor para pedir solo lo nuevo', async () => {
      for (const n of [1, 2, 3]) {
        await h.log.record({ type: 'payment.quoted', message: `e${n}` })
        h.advance(1000)
      }
      const first = await h.log.list({})
      expect(first.items.map((e) => e.message)).toEqual(['e1', 'e2', 'e3'])
      expect(first.nextCursor).toBeTruthy()

      expect((await h.log.list({ after: first.nextCursor })).items).toEqual([])

      await h.log.record({ type: 'payment.quoted', message: 'e4' })
      const next = await h.log.list({ after: first.nextCursor })
      expect(next.items.map((e) => e.message)).toEqual(['e4'])
    })

    it('un cursor intermedio devuelve solo los eventos posteriores', async () => {
      for (const n of [1, 2, 3, 4]) {
        await h.log.record({ type: 'payment.quoted', message: `e${n}` })
      }
      const page = await h.log.list({ limit: 2 })
      expect(page.items.map((e) => e.message)).toEqual(['e1', 'e2'])
      const rest = await h.log.list({ after: page.nextCursor })
      expect(rest.items.map((e) => e.message)).toEqual(['e3', 'e4'])
    })

    it('el límite por defecto y máximo es 100', async () => {
      for (let n = 0; n < 105; n++) {
        await h.log.record({ type: 'payment.quoted', message: `e${n}` })
      }
      expect((await h.log.list({})).items).toHaveLength(100)
      expect((await h.log.list({ limit: 500 })).items).toHaveLength(100)
    })

    it('filtra por pago, por tipo y por nivel', async () => {
      await h.log.record({ type: 'payment.quoted', paymentId: 'pay_1', message: 'a' })
      await h.log.record({ type: 'payment.confirmed', paymentId: 'pay_1', message: 'b' })
      await h.log.record({ type: 'payment.quoted', paymentId: 'pay_2', message: 'c' })
      await h.log.record({
        type: 'payment.failed',
        level: 'error',
        paymentId: 'pay_2',
        message: 'd'
      })

      const byPayment = await h.log.list({ paymentId: 'pay_1' })
      expect(byPayment.items.map((e) => e.message)).toEqual(['a', 'b'])
      const byType = await h.log.list({ type: 'payment.quoted' })
      expect(byType.items.map((e) => e.message)).toEqual(['a', 'c'])
      const byLevel = await h.log.list({ level: 'error' })
      expect(byLevel.items.map((e) => e.message)).toEqual(['d'])
    })

    it('el cursor se conserva cuando no hay eventos nuevos', async () => {
      await h.log.record({ type: 'payment.quoted', message: 'a' })
      const { nextCursor } = await h.log.list({})
      const again = await h.log.list({ after: nextCursor })
      expect(again.items).toEqual([])
      expect(again.nextCursor).toBe(nextCursor)
    })

    // Caso 15: nada sensible llega al evento guardado.
    it('solo conserva los campos permitidos del tipo de evento y descarta secretos', async () => {
      const event = await h.log.record({
        type: 'payment.quoted',
        message: 'Quote',
        data: {
          debitAmount: '25.07 USD',
          receiveAmount: '430.00 MXN',
          accessToken: 'tok-secret',
          continueToken: 'cont-secret',
          nonce: 'nonce-secret',
          hash: 'hash-secret',
          interact_ref: 'ref-secret',
          privateKey: 'key-secret',
          apiKey: 'api-secret',
          unexpectedField: 'x'
        }
      })
      expect(event.data).toEqual({
        debitAmount: '25.07 USD',
        receiveAmount: '430.00 MXN'
      })
      const stored = JSON.stringify((await h.log.list({})).items)
      for (const secret of ['tok-secret', 'cont-secret', 'nonce-secret', 'hash-secret']) {
        expect(stored).not.toContain(secret)
      }
      expect(stored).not.toContain('ref-secret')
      expect(stored).not.toContain('key-secret')
      expect(stored).not.toContain('api-secret')
    })

    it('un tipo sin campos permitidos guarda data vacío', async () => {
      const event = await h.log.record({
        type: 'something.unknown',
        message: 'm',
        data: { a: 'b' }
      })
      expect(event.data).toEqual({})
    })

    it('settings.updated conserva setting, previous y next', async () => {
      const event = await h.log.record({
        type: 'settings.updated',
        message: 'Configuración cambiada',
        data: { setting: 'feePercentage', previous: '0', next: '1.5', token: 'nope' }
      })
      expect(event.data).toEqual({ setting: 'feePercentage', previous: '0', next: '1.5' })
    })
  })
}
