import { describe, expect, it } from 'vitest'
import { createFeeSummaryProvider } from '../../src/modules/fees/fee-summary-provider.js'
import { createInMemoryPaymentsRepository } from '../../src/modules/payments/in-memory-payments.repository.js'
import { buildPayment } from '../contract/payments-repository.contract.js'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const hoursAgo = (hours: number): string => new Date(NOW - hours * 3600_000).toISOString()

describe('FeeSummaryProvider sobre el repositorio de pagos', () => {
  it('suma las comisiones cobradas y cuenta las fallidas', async () => {
    const payments = createInMemoryPaymentsRepository()
    await payments.createPayment(
      buildPayment({
        id: 'pay_01JD000000000000000000001',
        feeStatus: 'COLLECTED',
        fee: { value: '0.10', assetCode: 'USD' },
        createdAt: hoursAgo(1)
      })
    )
    await payments.createPayment(
      buildPayment({
        id: 'pay_01JD000000000000000000002',
        feeStatus: 'COLLECTED',
        fee: { value: '0.25', assetCode: 'USD' },
        createdAt: hoursAgo(48)
      })
    )
    await payments.createPayment(
      buildPayment({ id: 'pay_01JD000000000000000000003', feeStatus: 'FAILED' })
    )

    const summary = await createFeeSummaryProvider({
      payments,
      now: () => NOW
    }).summary()

    expect(summary).toEqual({
      byCurrency: { USD: { last24h: '0.10', total: '0.35' } },
      failedCount: 1
    })
  })

  it('sin pagos devuelve un resumen vacío', async () => {
    const summary = await createFeeSummaryProvider({
      payments: createInMemoryPaymentsRepository(),
      now: () => NOW
    }).summary()
    expect(summary).toEqual({ byCurrency: {}, failedCount: 0 })
  })
})
