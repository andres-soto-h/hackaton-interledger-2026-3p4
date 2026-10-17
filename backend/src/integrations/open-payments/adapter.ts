import type { KeyObject } from 'node:crypto'
import {
  createAuthenticatedClient,
  createUnauthenticatedClient,
  isFinalizedGrantWithAccessToken,
  isPendingGrant,
  type AuthenticatedClient,
  type IncomingPayment as SdkIncomingPayment,
  type OutgoingPayment as SdkOutgoingPayment,
  type Quote as SdkQuote,
  type UnauthenticatedClient,
  type WalletAddress as SdkWalletAddress
} from '@interledger/open-payments'
import type { Logger } from '../../shared/logger.js'
import { AppError } from '../../shared/errors/app-error.js'
import { fromMinorUnits, toMinorUnits } from '../../shared/money/money.js'
import type { Amount } from '../../shared/money/types.js'
import { toApiError } from './errors.js'
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

interface SdkAmount {
  value: string
  assetCode: string
  assetScale: number
}

interface SdkGrantAccess {
  type?: string
  limits?: {
    debitAmount?: SdkAmount
    interval?: string
  }
}

export interface CreateOpenPaymentsGatewayOptions {
  walletAddressUrl: string
  keyId: string
  privateKey: KeyObject
  timeoutMs: number
  retryBaseDelayMs?: number
  logger?: Logger
}

const MAX_ATTEMPTS = 3

const toAmount = (amount: SdkAmount): Amount => ({
  value: fromMinorUnits(amount.value, amount.assetScale),
  assetCode: amount.assetCode
})

const toSdkAmount = (
  value: string,
  assetCode: string,
  assetScale: number
): SdkAmount => ({
  value: toMinorUnits(value, assetScale),
  assetCode,
  assetScale
})

const descriptionFromMetadata = (
  metadata: { [key: string]: unknown } | undefined
): string | undefined =>
  metadata !== undefined && typeof metadata.description === 'string'
    ? metadata.description
    : undefined

const mapWalletAddress = (wallet: SdkWalletAddress): WalletAddress => ({
  id: wallet.id,
  publicName: wallet.publicName,
  assetCode: wallet.assetCode,
  assetScale: wallet.assetScale,
  authServer: wallet.authServer,
  resourceServer: wallet.resourceServer
})

const mapIncomingPayment = (payment: SdkIncomingPayment): IncomingPayment => ({
  id: payment.id,
  walletAddress: payment.walletAddress,
  ...(payment.incomingAmount !== undefined
    ? { incomingAmount: toAmount(payment.incomingAmount) }
    : {}),
  receivedAmount: toAmount(payment.receivedAmount),
  completed: payment.completed,
  ...(payment.expiresAt !== undefined ? { expiresAt: new Date(payment.expiresAt) } : {}),
  ...(descriptionFromMetadata(payment.metadata) !== undefined
    ? { description: descriptionFromMetadata(payment.metadata) }
    : {})
})

const mapQuote = (quote: SdkQuote): Quote => ({
  id: quote.id,
  walletAddress: quote.walletAddress,
  receiver: quote.receiver,
  debitAmount: toAmount(quote.debitAmount),
  receiveAmount: toAmount(quote.receiveAmount),
  expiresAt: new Date(quote.expiresAt ?? 0)
})

const mapOutgoingPayment = (payment: SdkOutgoingPayment): OutgoingPayment => ({
  id: payment.id,
  walletAddress: payment.walletAddress,
  quoteId: payment.quoteId ?? '',
  receiver: payment.receiver,
  debitAmount: toAmount(payment.debitAmount),
  receiveAmount: toAmount(payment.receiveAmount),
  sentAmount: toAmount(payment.sentAmount),
  failed: payment.failed,
  ...(descriptionFromMetadata(payment.metadata) !== undefined
    ? { description: descriptionFromMetadata(payment.metadata) }
    : {})
})

const mapGrantResult = (token: {
  value: string
  manage: string
  expires_in?: number
  access?: SdkGrantAccess[]
}): GrantResult => {
  const result: GrantResult = {
    accessToken: token.value,
    manageUrl: token.manage,
    ...(token.expires_in !== undefined
      ? { expiresAt: new Date(Date.now() + token.expires_in * 1000) }
      : {})
  }
  const limits = grantedLimitsFromAccess(token.access)
  if (limits !== undefined) result.grantedLimits = limits
  return result
}

const grantedLimitsFromAccess = (
  access: SdkGrantAccess[] | undefined
): { debitAmount: Amount; interval: string } | undefined => {
  if (access === undefined) return undefined
  const outgoing = access.find((entry) => entry.type === 'outgoing-payment')
  const limits = outgoing?.limits
  if (limits?.debitAmount === undefined || limits.interval === undefined) return undefined
  return {
    debitAmount: toAmount(limits.debitAmount),
    interval: limits.interval
  }
}

// ky (the SDK's HTTP client) already retries transient network errors for GET
// requests up to 2 times. The adapter only adds its own retries for timeouts,
// which ky does not retry, so reads get at most 2 retries (3 attempts) total
// and the two backoff mechanisms never stack.
const isRetryable = (error: AppError): boolean => error.code === 'OPEN_PAYMENTS_TIMEOUT'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * SDK adapter for the `OpenPaymentsGateway` port (spec 003). A single
 * authenticated client is created per instance; non-interactive grants are
 * requested inline and their tokens never leave the adapter.
 */
export async function createOpenPaymentsGateway(
  options: CreateOpenPaymentsGatewayOptions
): Promise<OpenPaymentsGateway> {
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 200
  const logger = options.logger

  const client: AuthenticatedClient = await createAuthenticatedClient({
    walletAddressUrl: options.walletAddressUrl,
    keyId: options.keyId,
    privateKey: options.privateKey,
    requestTimeoutMs: options.timeoutMs
  })

  // Public reads (incoming payment without a token) do not need response
  // validation: they return public fields that the SDK does not model fully.
  const publicClient: UnauthenticatedClient = await createUnauthenticatedClient({
    requestTimeoutMs: options.timeoutMs,
    validateResponses: false
  })

  const run = async <T>(
    operation: GatewayOperation,
    fn: () => Promise<T>
  ): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      throw toApiError(error, operation, logger)
    }
  }

  const runWithRetry = async <T>(
    operation: GatewayOperation,
    fn: () => Promise<T>
  ): Promise<T> => {
    let lastError: AppError | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = toApiError(error, operation, logger)
        if (!isRetryable(lastError) || attempt === MAX_ATTEMPTS - 1) throw lastError
        await sleep(retryBaseDelayMs * 2 ** attempt)
      }
    }
    throw lastError ?? new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')
  }

  return {
    getWalletAddress(url: string): Promise<WalletAddress> {
      return runWithRetry('getWalletAddress', async () => {
        return mapWalletAddress(await client.walletAddress.get({ url }))
      })
    },

    createIncomingPayment(input: {
      wallet: WalletAddress
      amount?: Amount
      expiresAt: Date
      description?: string
    }): Promise<IncomingPayment> {
      return run('createIncomingPayment', async () => {
        const grant = await client.grant.request(
          { url: input.wallet.authServer },
          {
            access_token: {
              access: [{ type: 'incoming-payment', actions: ['create', 'read'] }]
            }
          }
        )
        if (!isFinalizedGrantWithAccessToken(grant)) {
          throw new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')
        }

        const incoming = await client.incomingPayment.create(
          { url: input.wallet.resourceServer, accessToken: grant.access_token.value },
          {
            walletAddress: input.wallet.id,
            ...(input.amount !== undefined
              ? {
                  incomingAmount: toSdkAmount(
                    input.amount.value,
                    input.wallet.assetCode,
                    input.wallet.assetScale
                  )
                }
              : {}),
            expiresAt: input.expiresAt.toISOString(),
            ...(input.description !== undefined
              ? { metadata: { description: input.description } }
              : {})
          }
        )
        return mapIncomingPayment(incoming)
      })
    },

    getIncomingPayment(url: string): Promise<IncomingPayment> {
      return runWithRetry('getIncomingPayment', async () => {
        const payment = (await publicClient.incomingPayment.get({
          url
        })) as unknown as SdkIncomingPayment
        return mapIncomingPayment({ ...payment, id: url })
      })
    },

    createQuote(input: {
      sender: WalletAddress
      receiver: string
      debitAmount?: Amount
    }): Promise<Quote> {
      return run('createQuote', async () => {
        const grant = await client.grant.request(
          { url: input.sender.authServer },
          {
            access_token: {
              access: [{ type: 'quote', actions: ['create', 'read'] }]
            }
          }
        )
        if (!isFinalizedGrantWithAccessToken(grant)) {
          throw new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')
        }

        const quote = await client.quote.create(
          { url: input.sender.resourceServer, accessToken: grant.access_token.value },
          {
            walletAddress: input.sender.id,
            receiver: input.receiver,
            method: 'ilp',
            ...(input.debitAmount !== undefined
              ? {
                  debitAmount: toSdkAmount(
                    input.debitAmount.value,
                    input.sender.assetCode,
                    input.sender.assetScale
                  )
                }
              : {})
          }
        )
        return mapQuote(quote)
      })
    },

    requestOutgoingPaymentGrant(input: {
      sender: WalletAddress
      limits: { debitAmount: Amount; interval: string }
      finishUri: string
      clientNonce: string
    }): Promise<PendingGrant> {
      return run('requestOutgoingPaymentGrant', async () => {
        const grant = await client.grant.request(
          { url: input.sender.authServer },
          {
            access_token: {
              access: [
                {
                  type: 'outgoing-payment',
                  actions: ['create', 'read'],
                  identifier: input.sender.id,
                  limits: {
                    debitAmount: toSdkAmount(
                      input.limits.debitAmount.value,
                      input.sender.assetCode,
                      input.sender.assetScale
                    ),
                    interval: input.limits.interval
                  }
                }
              ]
            },
            interact: {
              start: ['redirect'],
              finish: {
                method: 'redirect',
                uri: input.finishUri,
                nonce: input.clientNonce
              }
            }
          }
        )
        if (!isPendingGrant(grant)) {
          throw new AppError(502, 'OPEN_PAYMENTS_ERROR', 'Open Payments error')
        }
        return {
          interactRedirectUrl: grant.interact.redirect,
          continueUri: grant.continue.uri,
          continueToken: grant.continue.access_token.value,
          finishNonce: grant.interact.finish
        }
      })
    },

    continueGrant(input: {
      continueUri: string
      continueToken: string
      interactRef: string
    }): Promise<GrantResult> {
      return run('continueGrant', async () => {
        const grant = await client.grant.continue(
          { url: input.continueUri, accessToken: input.continueToken },
          { interact_ref: input.interactRef }
        )
        if (!isFinalizedGrantWithAccessToken(grant)) {
          throw new AppError(409, 'GRANT_NOT_FINALIZED', 'Grant is not finalized yet')
        }
        return mapGrantResult(grant.access_token)
      })
    },

    createOutgoingPayment(input: {
      sender: WalletAddress
      quoteId: string
      accessToken: string
      description?: string
    }): Promise<OutgoingPayment> {
      return run('createOutgoingPayment', async () => {
        const outgoing = await client.outgoingPayment.create(
          { url: input.sender.resourceServer, accessToken: input.accessToken },
          {
            walletAddress: input.sender.id,
            quoteId: input.quoteId,
            ...(input.description !== undefined
              ? { metadata: { description: input.description } }
              : {})
          }
        )
        return mapOutgoingPayment(outgoing)
      })
    },

    getOutgoingPayment(input: {
      url: string
      accessToken: string
    }): Promise<OutgoingPayment> {
      return runWithRetry('getOutgoingPayment', async () => {
        const outgoing = await client.outgoingPayment.get({
          url: input.url,
          accessToken: input.accessToken
        })
        return mapOutgoingPayment(outgoing)
      })
    },

    rotateToken(input: {
      manageUrl: string
      accessToken: string
    }): Promise<{ accessToken: string; manageUrl: string; expiresAt?: Date }> {
      return run('rotateToken', async () => {
        const result = await client.token.rotate({
          url: input.manageUrl,
          accessToken: input.accessToken
        })
        return mapGrantResult(result.access_token)
      })
    },

    cancelGrant(input: { continueUri: string; continueToken: string }): Promise<void> {
      return run('cancelGrant', async () => {
        await client.grant.cancel({
          url: input.continueUri,
          accessToken: input.continueToken
        })
      })
    }
  }
}
