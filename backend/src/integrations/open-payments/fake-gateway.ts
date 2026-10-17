import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors/app-error.js'
import { fromMinorUnits } from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import type {
  GatewayOperation,
  GrantResult,
  IncomingPayment,
  OpenPaymentsGateway,
  OutgoingPayment,
  PendingGrant,
  Quote,
  WalletAddress
} from './gateway.js'

interface PendingGrantState {
  finishNonce: string
  sender: WalletAddress
  finishUri: string
  clientNonce: string
  limits: { debitAmount: Amount; interval: string }
}

interface GrantState {
  manageUrl: string
  continueToken: string
}

export interface GrantRequestRecord {
  sender: WalletAddress
  limits: { debitAmount: Amount; interval: string }
  finishUri: string
  clientNonce: string
  continueToken: string
}

export interface FakeOpenPaymentsGateway extends OpenPaymentsGateway {
  addWallet(wallet: WalletAddress): void
  completeOutgoingPayment(id: string): void
  failOutgoingPayment(id: string): void
  failNext(operation: GatewayOperation, error: unknown): void
  /** Every interactive grant requested, in order. */
  grantRequests(): GrantRequestRecord[]
  /** `continueToken`s of the grants cancelled via `cancelGrant`. */
  cancelledGrants(): string[]
  /** Marks a token as rejected by the auth server (it can still be rotated). */
  invalidateAccessToken(token: string): void
  /** Overrides the granted limits only for the next `continueGrant` call. */
  overrideNextGrantedLimits(limits: { debitAmount: Amount; interval: string }): void
  /** Revokes every grant: tokens fail and rotation is refused. */
  revokeGrants(): void
}

const appError = (status: number, code: string): AppError =>
  new AppError(status, code, code)

const zeroAmount = (wallet: WalletAddress): Amount => ({
  value: fromMinorUnits('0', wallet.assetScale),
  assetCode: wallet.assetCode
})

const resourceUrl = (resourceServer: string, resource: string, id: string): string =>
  `${resourceServer.replace(/\/+$/, '')}/${resource}/${id}`

/**
 * In-memory implementation of the gateway port used by other specs' tests. It
 * honours the same types and errors as the SDK adapter, but performs no network
 * calls and never converts between currencies.
 */
export function createFakeOpenPaymentsGateway({
  now = () => new Date(),
  tokenTtlSeconds = 600
}: { now?: () => Date; tokenTtlSeconds?: number } = {}): FakeOpenPaymentsGateway {
  const wallets = new Map<string, WalletAddress>()
  const incomingPayments = new Map<string, IncomingPayment>()
  const quotes = new Map<string, Quote>()
  const outgoingPayments = new Map<string, OutgoingPayment>()
  const pendingGrants = new Map<string, PendingGrantState>()
  const accessTokens = new Map<string, GrantState>()
  const failQueues = new Map<GatewayOperation, unknown[]>()
  const grantRequestLog: GrantRequestRecord[] = []
  const cancelledGrantLog: string[] = []
  const invalidatedTokens = new Set<string>()
  let revoked = false
  let nextGrantedLimits: { debitAmount: Amount; interval: string } | undefined

  const expiresAt = (): Date => new Date(now().getTime() + tokenTtlSeconds * 1000)

  // Runs the synchronous body as a Promise so that both `failNext` and errors
  // thrown inside it surface as rejections (never as synchronous throws).
  const call = <T>(operation: GatewayOperation, fn: () => T): Promise<T> => {
    const failure = failQueues.get(operation)?.shift()
    if (failure !== undefined) {
      return Promise.reject(
        failure instanceof Error ? failure : new Error('Injected gateway failure')
      )
    }
    try {
      return Promise.resolve(fn())
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('Open Payments gateway failure')
      )
    }
  }

  const walletById = (id: string): WalletAddress => {
    const wallet = wallets.get(id)
    if (!wallet) throw appError(422, 'WALLET_NOT_FOUND')
    return wallet
  }

  const incomingByUrl = (url: string): IncomingPayment => {
    const incoming = incomingPayments.get(url)
    if (!incoming) throw appError(502, 'OPEN_PAYMENTS_ERROR')
    return incoming
  }

  const quoteById = (id: string): Quote => {
    const quote = quotes.get(id)
    if (!quote) throw appError(502, 'OPEN_PAYMENTS_ERROR')
    return quote
  }

  const assertAccessToken = (token: string): void => {
    if (revoked || invalidatedTokens.has(token)) {
      throw appError(502, 'OPEN_PAYMENTS_UNAUTHORIZED')
    }
    if (!accessTokens.has(token)) throw appError(502, 'OPEN_PAYMENTS_ERROR')
  }

  return {
    addWallet(wallet: WalletAddress): void {
      wallets.set(wallet.id, wallet)
    },

    getWalletAddress(url: string): Promise<WalletAddress> {
      return call('getWalletAddress', () => walletById(url))
    },

    createIncomingPayment(input: {
      wallet: WalletAddress
      amount?: Amount
      expiresAt: Date
      description?: string
    }): Promise<IncomingPayment> {
      return call('createIncomingPayment', () => {
        const incoming: IncomingPayment = {
          id: resourceUrl(input.wallet.resourceServer, 'incoming-payments', randomUUID()),
          walletAddress: input.wallet.id,
          ...(input.amount !== undefined ? { incomingAmount: input.amount } : {}),
          receivedAmount: zeroAmount(input.wallet),
          completed: false,
          expiresAt: input.expiresAt,
          ...(input.description !== undefined ? { description: input.description } : {})
        }
        incomingPayments.set(incoming.id, incoming)
        return incoming
      })
    },

    getIncomingPayment(url: string): Promise<IncomingPayment> {
      return call('getIncomingPayment', () => incomingByUrl(url))
    },

    createQuote(input: {
      sender: WalletAddress
      receiver: string
      debitAmount?: Amount
    }): Promise<Quote> {
      return call('createQuote', () => {
        const incoming = incomingByUrl(input.receiver)
        const receiverWallet = walletById(incoming.walletAddress)

        if (input.sender.assetCode !== receiverWallet.assetCode) {
          throw appError(422, 'QUOTE_FAILED')
        }

        const debitAmount = incoming.incomingAmount ?? input.debitAmount
        if (debitAmount === undefined) throw appError(502, 'OPEN_PAYMENTS_ERROR')

        const quote: Quote = {
          id: resourceUrl(input.sender.resourceServer, 'quotes', randomUUID()),
          walletAddress: input.sender.id,
          receiver: input.receiver,
          debitAmount,
          receiveAmount: debitAmount,
          expiresAt: new Date(now().getTime() + 5 * 60_000)
        }
        quotes.set(quote.id, quote)
        return quote
      })
    },

    requestOutgoingPaymentGrant(input: {
      sender: WalletAddress
      limits: { debitAmount: Amount; interval: string }
      finishUri: string
      clientNonce: string
    }): Promise<PendingGrant> {
      return call('requestOutgoingPaymentGrant', () => {
        const continueToken = randomUUID()
        const pending: PendingGrant = {
          interactRedirectUrl: `https://auth.interledger-test.dev/interact/${randomUUID()}`,
          continueUri: `https://auth.interledger-test.dev/continue/${continueToken}`,
          continueToken,
          finishNonce: randomUUID()
        }
        pendingGrants.set(continueToken, {
          finishNonce: pending.finishNonce,
          sender: input.sender,
          finishUri: input.finishUri,
          clientNonce: input.clientNonce,
          limits: input.limits
        })
        grantRequestLog.push({
          sender: input.sender,
          limits: input.limits,
          finishUri: input.finishUri,
          clientNonce: input.clientNonce,
          continueToken
        })
        return pending
      })
    },

    continueGrant(input: {
      continueUri: string
      continueToken: string
      interactRef: string
    }): Promise<GrantResult> {
      return call('continueGrant', () => {
        const pending = pendingGrants.get(input.continueToken)
        if (!pending) throw appError(502, 'OPEN_PAYMENTS_ERROR')

        const accessToken = randomUUID()
        const manageUrl = `https://auth.interledger-test.dev/token/${accessToken}`
        accessTokens.set(accessToken, {
          manageUrl,
          continueToken: input.continueToken
        })
        const grantedLimits = nextGrantedLimits ?? pending.limits
        nextGrantedLimits = undefined
        return { accessToken, manageUrl, expiresAt: expiresAt(), grantedLimits }
      })
    },

    createOutgoingPayment(input: {
      sender: WalletAddress
      quoteId: string
      accessToken: string
      description?: string
    }): Promise<OutgoingPayment> {
      return call('createOutgoingPayment', () => {
        assertAccessToken(input.accessToken)
        const quote = quoteById(input.quoteId)

        const outgoing: OutgoingPayment = {
          id: resourceUrl(input.sender.resourceServer, 'outgoing-payments', randomUUID()),
          walletAddress: input.sender.id,
          quoteId: quote.id,
          receiver: quote.receiver,
          debitAmount: quote.debitAmount,
          receiveAmount: quote.receiveAmount,
          sentAmount: zeroAmount(input.sender),
          failed: false,
          ...(input.description !== undefined ? { description: input.description } : {})
        }
        outgoingPayments.set(outgoing.id, outgoing)
        return outgoing
      })
    },

    getOutgoingPayment(input: {
      url: string
      accessToken: string
    }): Promise<OutgoingPayment> {
      return call('getOutgoingPayment', () => {
        assertAccessToken(input.accessToken)
        const outgoing = outgoingPayments.get(input.url)
        if (!outgoing) throw appError(502, 'OPEN_PAYMENTS_ERROR')
        return outgoing
      })
    },

    rotateToken(input: {
      manageUrl: string
      accessToken: string
    }): Promise<{ accessToken: string; manageUrl: string; expiresAt?: Date }> {
      return call('rotateToken', () => {
        if (revoked) throw appError(409, 'GRANT_REVOKED')
        const grant = accessTokens.get(input.accessToken)
        if (!grant) throw appError(502, 'OPEN_PAYMENTS_ERROR')

        const nextToken = randomUUID()
        accessTokens.delete(input.accessToken)
        accessTokens.set(nextToken, grant)
        return {
          accessToken: nextToken,
          manageUrl: grant.manageUrl,
          expiresAt: expiresAt()
        }
      })
    },

    cancelGrant(input: { continueUri: string; continueToken: string }): Promise<void> {
      return call('cancelGrant', () => {
        cancelledGrantLog.push(input.continueToken)
        for (const [token, grant] of accessTokens) {
          if (grant.continueToken === input.continueToken) accessTokens.delete(token)
        }
      })
    },

    completeOutgoingPayment(id: string): void {
      const outgoing = outgoingPayments.get(id)
      if (!outgoing) return
      outgoing.sentAmount = outgoing.debitAmount
      outgoing.failed = false
    },

    failOutgoingPayment(id: string): void {
      const outgoing = outgoingPayments.get(id)
      if (!outgoing) return
      outgoing.failed = true
    },

    failNext(operation: GatewayOperation, error: unknown): void {
      const queue = failQueues.get(operation) ?? []
      queue.push(error)
      failQueues.set(operation, queue)
    },

    grantRequests(): GrantRequestRecord[] {
      return [...grantRequestLog]
    },

    cancelledGrants(): string[] {
      return [...cancelledGrantLog]
    },

    invalidateAccessToken(token: string): void {
      invalidatedTokens.add(token)
    },

    overrideNextGrantedLimits(limits: { debitAmount: Amount; interval: string }): void {
      nextGrantedLimits = limits
    },

    revokeGrants(): void {
      revoked = true
    }
  }
}
