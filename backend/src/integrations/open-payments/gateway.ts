import type { Amount } from '../../shared/money/types.js'

export interface WalletAddress {
  id: string
  publicName?: string
  assetCode: string
  assetScale: number
  authServer: string
  resourceServer: string
}

export interface IncomingPayment {
  id: string
  walletAddress: string
  incomingAmount?: Amount
  receivedAmount: Amount
  completed: boolean
  expiresAt?: Date
  description?: string
}

export interface Quote {
  id: string
  walletAddress: string
  receiver: string
  debitAmount: Amount
  receiveAmount: Amount
  expiresAt: Date
}

export interface PendingGrant {
  interactRedirectUrl: string
  continueUri: string
  continueToken: string
  finishNonce: string
}

export interface GrantResult {
  accessToken: string
  manageUrl: string
  expiresAt?: Date
  grantedLimits?: { debitAmount: Amount; interval: string }
}

export interface OutgoingPayment {
  id: string
  walletAddress: string
  quoteId: string
  receiver: string
  debitAmount: Amount
  receiveAmount: Amount
  sentAmount: Amount
  failed: boolean
  description?: string
}

/** Port implemented by the SDK adapter and by the in-memory fake (spec 003). */
export interface OpenPaymentsGateway {
  getWalletAddress(url: string): Promise<WalletAddress>
  createIncomingPayment(input: {
    wallet: WalletAddress
    amount?: Amount
    expiresAt: Date
    description?: string
  }): Promise<IncomingPayment>
  getIncomingPayment(url: string): Promise<IncomingPayment>
  createQuote(input: {
    sender: WalletAddress
    receiver: string
    debitAmount?: Amount
  }): Promise<Quote>
  requestOutgoingPaymentGrant(input: {
    sender: WalletAddress
    limits: { debitAmount: Amount; interval: string }
    finishUri: string
    clientNonce: string
  }): Promise<PendingGrant>
  continueGrant(input: {
    continueUri: string
    continueToken: string
    interactRef: string
  }): Promise<GrantResult>
  createOutgoingPayment(input: {
    sender: WalletAddress
    quoteId: string
    accessToken: string
    description?: string
  }): Promise<OutgoingPayment>
  getOutgoingPayment(input: {
    url: string
    accessToken: string
  }): Promise<OutgoingPayment>
  rotateToken(input: {
    manageUrl: string
    accessToken: string
  }): Promise<{ accessToken: string; manageUrl: string; expiresAt?: Date }>
  cancelGrant(input: { continueUri: string; continueToken: string }): Promise<void>
}

export type GatewayOperation = keyof OpenPaymentsGateway
