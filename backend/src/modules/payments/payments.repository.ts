import type {
  Payment,
  PaymentRequest,
  PaymentRequestStatus,
  PaymentStatus
} from './payment.types.js'

export interface ListByWalletQuery {
  walletAddress: string
  direction: 'incoming' | 'outgoing' | 'all'
  kind: 'payment' | 'payment-request' | 'all'
  status?: string
  limit: number
  cursor?: string
}

export interface PaymentsRepository {
  createPayment(p: Payment): Promise<void>
  getPayment(id: string): Promise<Payment | null>
  updatePayment(
    id: string,
    changes: Partial<Payment>,
    opts: { expectedStatus: PaymentStatus }
  ): Promise<Payment>
  createPaymentRequest(r: PaymentRequest): Promise<void>
  getPaymentRequest(id: string): Promise<PaymentRequest | null>
  updatePaymentRequest(
    id: string,
    changes: Partial<PaymentRequest>,
    opts: { expectedStatus: PaymentRequestStatus }
  ): Promise<PaymentRequest>
  listByWallet(q: ListByWalletQuery): Promise<{
    items: (Payment | PaymentRequest)[]
    nextCursor?: string
  }>
}

/** The stored status differs from the expected one, or the payment does not exist. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}
