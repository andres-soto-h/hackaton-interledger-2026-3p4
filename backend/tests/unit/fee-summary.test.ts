import { describe, expect, it } from 'vitest'
import { summarizeFees } from '../../src/modules/fees/fee-summary.js'
import type { FeeStatus, Payment } from '../../src/modules/payments/payment.types.js'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const HOUR = 3600_000

const payment = (
  id: string,
  feeStatus: FeeStatus,
  fee: string,
  assetCode: string,
  ageMs: number
): Payment => ({
  id,
  userId: 'usr_1',
  walletLinkId: 'wl_1',
  type: 'p2p',
  senderWalletAddress: 'https://w.example/alice',
  receiverWalletAddress: 'https://w.example/bob',
  incomingPaymentUrl: 'https://w.example/incoming-payments/1',
  fixedAmountSide: 'receive',
  quote: {
    id: 'q',
    debitAmount: { value: '10.00', assetCode },
    receiveAmount: { value: '10.00', assetCode },
    expiresAt: new Date(NOW - ageMs).toISOString()
  },
  feePercentage: '1.5',
  fee: { value: fee, assetCode },
  totalDebit: { value: '10.00', assetCode },
  feeStatus,
  status: 'COMPLETED',
  createdAt: new Date(NOW - ageMs).toISOString(),
  updatedAt: new Date(NOW - ageMs).toISOString()
})

// Caso 10 (resumen del panel)
describe('summarizeFees', () => {
  it('suma lo cobrado por moneda (últimas 24 h y total) y cuenta las fallidas', () => {
    const summary = summarizeFees(
      [
        payment('p1', 'COLLECTED', '0.38', 'USD', 1 * HOUR),
        payment('p2', 'COLLECTED', '0.15', 'USD', 30 * HOUR),
        payment('p3', 'COLLECTED', '12', 'JPY', 2 * HOUR),
        payment('p4', 'FAILED', '0.20', 'USD', 3 * HOUR),
        payment('p5', 'PROCESSING', '0.50', 'USD', 1 * HOUR),
        payment('p6', 'NONE', '0.00', 'USD', 1 * HOUR)
      ],
      NOW
    )
    expect(summary.byCurrency).toEqual({
      USD: { last24h: '0.38', total: '0.53' },
      JPY: { last24h: '12', total: '12' }
    })
    expect(summary.failedCount).toBe(1)
  })

  it('sin pagos devuelve un resumen vacío', () => {
    expect(summarizeFees([], NOW)).toEqual({ byCurrency: {}, failedCount: 0 })
  })
})
