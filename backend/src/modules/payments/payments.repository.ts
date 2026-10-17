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

export interface ListAllPaymentsQuery {
  status?: PaymentStatus
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
  /** Every payment (never payment requests); used by the admin fee summary (spec 024). */
  listAllPayments(): Promise<Payment[]>
  listByWallet(q: ListByWalletQuery): Promise<{
    items: (Payment | PaymentRequest)[]
    nextCursor?: string
  }>
  /** Panel listing (spec 022): every payment, newest first, across all wallets. */
  listAllPayments(q: ListAllPaymentsQuery): Promise<{
    items: Payment[]
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
