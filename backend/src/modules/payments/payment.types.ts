import type { Amount, FixedAmountSide } from '../../shared/money/types.js'

export type PaymentType = 'p2p' | 'p2m'

export type PaymentStatus =
  | 'AWAITING_CONFIRMATION'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

export type PaymentRequestStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED'

export type FeeStatus = 'NONE' | 'PENDING' | 'PROCESSING' | 'COLLECTED' | 'FAILED'

export interface PaymentQuote {
  id: string
  debitAmount: Amount
  receiveAmount: Amount
  expiresAt: string
}

/**
 * Flow state of a payment. Never stores Open Payments tokens (they live,
 * encrypted, in the wallet link). `expiresAt` is the TTL in epoch seconds and
 * only exists while the payment is in `AWAITING_CONFIRMATION`.
 */
export interface Payment {
  id: string
  userId: string
  walletLinkId: string
  type: PaymentType
  senderWalletAddress: string
  receiverWalletAddress: string
  incomingPaymentUrl: string
  fixedAmountSide: FixedAmountSide
  quote: PaymentQuote
  feePercentage: string
  fee: Amount
  totalDebit: Amount
  feeStatus: FeeStatus
  feeIncomingPaymentUrl?: string
  feeOutgoingPaymentUrl?: string
  reservedAmount?: Amount
  status: PaymentStatus
  outgoingPaymentUrl?: string
  sentAmount?: Amount
  description?: string
  error?: { code: string; message: string }
  createdAt: string
  updatedAt: string
  expiresAt?: number
}

export interface PaymentRequest {
  id: string
  type: PaymentType
  receiverWalletAddress: string
  incomingPaymentUrl: string
  amount: Amount
  description?: string
  status: PaymentRequestStatus
  expiresAt: string
  createdAt: string
  updatedAt: string
}
