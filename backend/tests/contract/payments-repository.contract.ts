import { beforeEach, describe, expect, it } from 'vitest'
import type { Payment, PaymentRequest } from '../../src/modules/payments/payment.types.js'
import {
  ConflictError,
  type PaymentsRepository
} from '../../src/modules/payments/payments.repository.js'

const ALICE = 'https://ilp.interledger-test.dev/alice'
const BOB = 'https://ilp.interledger-test.dev/bob'
const SHOP = 'https://ilp.interledger-test.dev/shop'

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 9, 16, 10, minute, 0)).toISOString()

const usd = (value: string) => ({ value, assetCode: 'USD' })

export const buildPayment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'pay_01JAAAAAAAAAAAAAAAAAAAAAAA',
  userId: 'usr_alice',
  walletLinkId: 'lnk_alice',
  type: 'p2p',
  senderWalletAddress: ALICE,
  receiverWalletAddress: BOB,
  incomingPaymentUrl: 'https://ilp.interledger-test.dev/incoming-payments/1',
  fixedAmountSide: 'receive',
  quote: {
    id: 'https://ilp.interledger-test.dev/quotes/1',
    debitAmount: usd('10.00'),
    receiveAmount: usd('10.00'),
    expiresAt: at(5)
  },
  feePercentage: '1',
  fee: usd('0.10'),
  totalDebit: usd('10.10'),
  feeStatus: 'PENDING',
  status: 'AWAITING_CONFIRMATION',
  description: 'Café',
  createdAt: at(0),
  updatedAt: at(0),
  expiresAt: Math.floor(Date.UTC(2026, 9, 16, 10, 5, 0) / 1000),
  ...overrides
})

export const buildPaymentRequest = (
  overrides: Partial<PaymentRequest> = {}
): PaymentRequest => ({
  id: 'pr_01JAAAAAAAAAAAAAAAAAAAAAAA',
  type: 'p2m',
  receiverWalletAddress: SHOP,
  incomingPaymentUrl: 'https://ilp.interledger-test.dev/incoming-payments/9',
  amount: usd('25.00'),
  description: 'Pedido 42',
  status: 'PENDING',
  expiresAt: at(30),
  createdAt: at(0),
  updatedAt: at(0),
  ...overrides
})

const ids = (items: { id: string }[]) => items.map((item) => item.id)

const extraId = (i: number) => `pay_01JC${String(i).padStart(22, '0')}`

/**
 * Behaviour every PaymentsRepository implementation must have (spec 004).
 * Runs against the in-memory implementation and, with Docker, DynamoDB Local.
 */
export function runPaymentsRepositoryContract(
  name: string,
  createRepository: () => PaymentsRepository | Promise<PaymentsRepository>
): void {
  describe(`PaymentsRepository contract: ${name}`, () => {
    let repo: PaymentsRepository

    beforeEach(async () => {
      repo = await createRepository()
    })

    // Spec 008: las solicitudes de pago pasan a COMPLETED / EXPIRED al refrescarse.
    describe('updatePaymentRequest', () => {
      it('cambia el estado de una solicitud PENDING y actualiza updatedAt', async () => {
        const request = buildPaymentRequest()
        await repo.createPaymentRequest(request)

        const updated = await repo.updatePaymentRequest(
          request.id,
          { status: 'COMPLETED', updatedAt: at(7) },
          { expectedStatus: 'PENDING' }
        )

        expect(updated).toEqual({ ...request, status: 'COMPLETED', updatedAt: at(7) })
        expect(await repo.getPaymentRequest(request.id)).toEqual(updated)
      })

      it('lanza ConflictError si el estado guardado no es el esperado o no existe', async () => {
        const request = buildPaymentRequest({ status: 'EXPIRED' })
        await repo.createPaymentRequest(request)

        await expect(
          repo.updatePaymentRequest(
            request.id,
            { status: 'COMPLETED' },
            { expectedStatus: 'PENDING' }
          )
        ).rejects.toBeInstanceOf(ConflictError)
        await expect(
          repo.updatePaymentRequest(
            'pr_01JBBBBBBBBBBBBBBBBBBBBBBB',
            { status: 'COMPLETED' },
            { expectedStatus: 'PENDING' }
          )
        ).rejects.toBeInstanceOf(ConflictError)
        expect((await repo.getPaymentRequest(request.id))?.status).toBe('EXPIRED')
      })
    })

    // Spec 022: lista de pagos del panel admin (de todas las wallets, más recientes primero).
    describe('listAllPayments', () => {
      const seed = async () => {
        await repo.createPayment(buildPayment({ id: extraId(1), createdAt: at(1) }))
        await repo.createPayment(
          buildPayment({
            id: extraId(2),
            createdAt: at(2),
            senderWalletAddress: BOB,
            receiverWalletAddress: ALICE,
            status: 'COMPLETED'
          })
        )
        await repo.createPayment(
          buildPayment({ id: extraId(3), createdAt: at(3), status: 'FAILED' })
        )
        await repo.createPaymentRequest(buildPaymentRequest())
      }

      it('devuelve solo pagos (no solicitudes) de todas las wallets, del más reciente al más antiguo', async () => {
        await seed()
        const result = await repo.listAllPayments({ limit: 10 })
        expect(ids(result.items)).toEqual([extraId(3), extraId(2), extraId(1)])
        expect(result.nextCursor).toBeUndefined()
      })

      it('filtra por estado', async () => {
        await seed()
        const result = await repo.listAllPayments({ status: 'COMPLETED', limit: 10 })
        expect(ids(result.items)).toEqual([extraId(2)])
      })

      it('pagina con cursor opaco sin repetir ni saltar pagos', async () => {
        await seed()
        const first = await repo.listAllPayments({ limit: 2 })
        expect(ids(first.items)).toEqual([extraId(3), extraId(2)])
        expect(first.nextCursor).toBeDefined()
        const second = await repo.listAllPayments({
          limit: 2,
          cursor: first.nextCursor
        })
        expect(ids(second.items)).toEqual([extraId(1)])
        expect(second.nextCursor).toBeUndefined()
      })

      it('sin pagos devuelve una lista vacía', async () => {
        expect(await repo.listAllPayments({ limit: 10 })).toEqual({ items: [] })
      })
    })

    // Caso 1
    it('guarda y lee un pago y una solicitud tal como se guardaron', async () => {
      const payment = buildPayment()
      const request = buildPaymentRequest()

      await repo.createPayment(payment)
      await repo.createPaymentRequest(request)

      expect(await repo.getPayment(payment.id)).toEqual(payment)
      expect(await repo.getPaymentRequest(request.id)).toEqual(request)
    })

    it('guarda un pago con los campos opcionales completos', async () => {
      const payment = buildPayment({
        status: 'COMPLETED',
        expiresAt: undefined,
        reservedAmount: usd('10.10'),
        outgoingPaymentUrl: 'https://ilp.interledger-test.dev/outgoing-payments/1',
        sentAmount: usd('10.00'),
        feeIncomingPaymentUrl: 'https://ilp.interledger-test.dev/incoming-payments/fee',
        feeOutgoingPaymentUrl: 'https://ilp.interledger-test.dev/outgoing-payments/fee',
        feeStatus: 'COLLECTED',
        error: { code: 'QUOTE_FAILED', message: 'No route' }
      })
      delete payment.expiresAt

      await repo.createPayment(payment)

      expect(await repo.getPayment(payment.id)).toEqual(payment)
    })

    // Caso 2
    it('devuelve null para IDs inexistentes', async () => {
      expect(await repo.getPayment('pay_01JZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull()
      expect(await repo.getPaymentRequest('pr_01JZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull()
    })

    // Caso 3
    it('actualiza un pago cuando el estado esperado coincide', async () => {
      const payment = buildPayment({ status: 'PROCESSING', expiresAt: undefined })
      delete payment.expiresAt
      await repo.createPayment(payment)

      const updated = await repo.updatePayment(
        payment.id,
        {
          status: 'COMPLETED',
          sentAmount: usd('10.00'),
          updatedAt: at(2)
        },
        { expectedStatus: 'PROCESSING' }
      )

      const expected = {
        ...payment,
        status: 'COMPLETED',
        sentAmount: usd('10.00'),
        updatedAt: at(2)
      }
      expect(updated).toEqual(expected)
      expect(await repo.getPayment(payment.id)).toEqual(expected)
    })

    // Caso 4
    it('rechaza la actualización si el estado esperado no coincide, sin cambios', async () => {
      const payment = buildPayment()
      await repo.createPayment(payment)

      await expect(
        repo.updatePayment(
          payment.id,
          { status: 'COMPLETED', updatedAt: at(3) },
          { expectedStatus: 'PROCESSING' }
        )
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await repo.getPayment(payment.id)).toEqual(payment)
    })

    it('rechaza con ConflictError la actualización de un pago inexistente', async () => {
      await expect(
        repo.updatePayment(
          'pay_01JZZZZZZZZZZZZZZZZZZZZZZZ',
          { status: 'PROCESSING' },
          { expectedStatus: 'AWAITING_CONFIRMATION' }
        )
      ).rejects.toBeInstanceOf(ConflictError)
    })

    // Caso 5
    it('de dos actualizaciones concurrentes desde el mismo estado solo una tiene éxito', async () => {
      const payment = buildPayment()
      await repo.createPayment(payment)

      const results = await Promise.allSettled([
        repo.updatePayment(
          payment.id,
          { status: 'PROCESSING', updatedAt: at(1) },
          { expectedStatus: 'AWAITING_CONFIRMATION' }
        ),
        repo.updatePayment(
          payment.id,
          { status: 'CANCELLED', updatedAt: at(1) },
          { expectedStatus: 'AWAITING_CONFIRMATION' }
        )
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)

      const winner = (fulfilled[0] as PromiseFulfilledResult<Payment>).value
      expect((await repo.getPayment(payment.id))?.status).toBe(winner.status)
    })

    // Caso 8
    it('quita expiresAt al salir de AWAITING_CONFIRMATION', async () => {
      const payment = buildPayment()
      await repo.createPayment(payment)

      const updated = await repo.updatePayment(
        payment.id,
        { status: 'PROCESSING', updatedAt: at(1) },
        { expectedStatus: 'AWAITING_CONFIRMATION' }
      )

      expect(updated.expiresAt).toBeUndefined()
      expect(updated).not.toHaveProperty('expiresAt')
      const stored = await repo.getPayment(payment.id)
      expect(stored).not.toHaveProperty('expiresAt')
      expect(stored?.status).toBe('PROCESSING')
    })

    // Spec 024: el resumen de comisiones del panel lee todos los pagos (no solicitudes).
    describe('listAllPayments', () => {
      it('devuelve todos los pagos y ninguna solicitud', async () => {
        const a = buildPayment({ id: 'pay_01JC000000000000000000001' })
        const b = buildPayment({
          id: 'pay_01JC000000000000000000002',
          senderWalletAddress: BOB,
          receiverWalletAddress: SHOP
        })
        await repo.createPayment(a)
        await repo.createPayment(b)
        await repo.createPaymentRequest(
          buildPaymentRequest({ id: 'pr_01JC000000000000000000001' })
        )

        const all = await repo.listAllPayments()

        expect(all.map((item) => item.id).sort()).toEqual([a.id, b.id])
      })

      it('devuelve una lista vacía sin pagos', async () => {
        expect(await repo.listAllPayments()).toEqual([])
      })
    })

    describe('listByWallet', () => {
      // alice → shop (p1), bob → alice (p2), solicitud para alice (r1), alice → bob (p3)
      const p1 = buildPayment({
        id: 'pay_01JB000000000000000000001',
        receiverWalletAddress: SHOP,
        type: 'p2m',
        createdAt: at(1),
        updatedAt: at(1)
      })
      const p2 = buildPayment({
        id: 'pay_01JB000000000000000000002',
        userId: 'usr_bob',
        senderWalletAddress: BOB,
        receiverWalletAddress: ALICE,
        createdAt: at(2),
        updatedAt: at(2)
      })
      const r1 = buildPaymentRequest({
        id: 'pr_01JB0000000000000000000003',
        type: 'p2p',
        receiverWalletAddress: ALICE,
        createdAt: at(3),
        updatedAt: at(3)
      })
      const p3 = buildPayment({
        id: 'pay_01JB000000000000000000004',
        status: 'COMPLETED',
        expiresAt: undefined,
        createdAt: at(4),
        updatedAt: at(4)
      })
      delete p3.expiresAt

      beforeEach(async () => {
        await repo.createPayment(p1)
        await repo.createPayment(p2)
        await repo.createPaymentRequest(r1)
        await repo.createPayment(p3)
      })

      const list = (query: Partial<Parameters<PaymentsRepository['listByWallet']>[0]>) =>
        repo.listByWallet({
          walletAddress: ALICE,
          direction: 'all',
          kind: 'all',
          limit: 50,
          ...query
        })

      // Caso 6
      it('lista lo enviado por la wallet, del más reciente al más antiguo', async () => {
        const page = await list({ direction: 'outgoing' })
        expect(ids(page.items)).toEqual([p3.id, p1.id])
        expect(page.nextCursor).toBeUndefined()
      })

      it('lista lo recibido por la wallet: pagos y solicitudes', async () => {
        const page = await list({ direction: 'incoming' })
        expect(ids(page.items)).toEqual([r1.id, p2.id])
      })

      it('combina enviados y recibidos con direction=all', async () => {
        const page = await list({})
        expect(ids(page.items)).toEqual([p3.id, r1.id, p2.id, p1.id])
        expect(page.items[0]).toEqual(p3)
        expect(page.items[1]).toEqual(r1)
      })

      it('filtra por tipo de elemento', async () => {
        expect(ids((await list({ kind: 'payment-request' })).items)).toEqual([r1.id])
        expect(ids((await list({ kind: 'payment' })).items)).toEqual([
          p3.id,
          p2.id,
          p1.id
        ])
        expect(
          ids((await list({ direction: 'outgoing', kind: 'payment-request' })).items)
        ).toEqual([])
      })

      it('filtra por estado', async () => {
        expect(ids((await list({ status: 'COMPLETED' })).items)).toEqual([p3.id])
        expect(ids((await list({ status: 'PENDING' })).items)).toEqual([r1.id])
      })

      it('devuelve una lista vacía para una wallet sin movimientos', async () => {
        const page = await list({
          walletAddress: 'https://ilp.interledger-test.dev/nobody'
        })
        expect(page).toEqual({ items: [] })
      })

      // Caso 7
      it('pagina con limit y cursor hasta el final sin duplicados ni faltantes', async () => {
        const seen: string[] = []
        let cursor: string | undefined
        const pageSizes: number[] = []
        do {
          const page = await list({ limit: 3, cursor })
          pageSizes.push(page.items.length)
          seen.push(...ids(page.items))
          cursor = page.nextCursor
        } while (cursor)

        expect(pageSizes).toEqual([3, 1])
        expect(seen).toEqual([p3.id, r1.id, p2.id, p1.id])
      })

      it('pagina una sola dirección', async () => {
        for (let i = 0; i < 3; i++) {
          await repo.createPayment(
            buildPayment({
              id: extraId(i),
              receiverWalletAddress: SHOP,
              createdAt: at(10 + i),
              updatedAt: at(10 + i)
            })
          )
        }

        const first = await list({ direction: 'outgoing', limit: 2 })
        expect(ids(first.items)).toEqual([extraId(2), extraId(1)])
        expect(first.nextCursor).toEqual(expect.any(String))

        const second = await list({
          direction: 'outgoing',
          limit: 2,
          cursor: first.nextCursor
        })
        expect(ids(second.items)).toEqual([extraId(0), p3.id])

        const third = await list({
          direction: 'outgoing',
          limit: 2,
          cursor: second.nextCursor
        })
        expect(ids(third.items)).toEqual([p1.id])
        expect(third.nextCursor).toBeUndefined()
      })
    })
  })
}
