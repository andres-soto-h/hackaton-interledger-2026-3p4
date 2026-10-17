import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import { AppError } from '../../shared/errors/app-error.js'
import type { Logger } from '../../shared/logger.js'
import type { Amount } from '../../shared/money/types.js'
import type { PaymentStatusService } from '../payments/payment-status.service.js'
import type { Payment, PaymentRequest, PaymentType } from '../payments/payment.types.js'
import {
  ConflictError,
  type PaymentsRepository
} from '../payments/payments.repository.js'
import type { User } from '../users/user.types.js'
import type { MerchantDirectory } from './merchant-directory.js'

export type TransactionDirection = 'incoming' | 'outgoing'

export interface TransactionItem {
  id: string
  kind: 'payment' | 'payment-request'
  direction: TransactionDirection
  type: PaymentType
  status: string
  counterparty: {
    name: string | null
    walletAddress: string
    merchantId: string | null
  } | null
  debitAmount: Amount | null
  receiveAmount: Amount | null
  fee: (Amount & { percentage: string }) | null
  totalDebit: Amount | null
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface ListTransactionsQuery {
  direction: 'incoming' | 'outgoing' | 'all'
  kind: 'payment' | 'payment-request' | 'all'
  status?: string
  limit: number
  cursor?: string
}

export interface TransactionsService {
  list(
    user: User,
    query: ListTransactionsQuery
  ): Promise<{ items: TransactionItem[]; nextCursor: string | null }>
}

export interface TransactionsServiceDeps {
  payments: PaymentsRepository
  gateway: OpenPaymentsGateway
  statusService: PaymentStatusService
  merchants: MerchantDirectory
  /** Milliseconds since the epoch. */
  now: () => number
  /** Maximum number of items refreshed/resolved at once. */
  refreshConcurrency?: number
  logger?: Pick<Logger, 'warn'>
}

type Item = Payment | PaymentRequest

const FINAL_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
])

const isPayment = (item: Item): item is Payment => 'senderWalletAddress' in item

const decimalPlaces = (value: string): number => {
  const dot = value.indexOf('.')
  return dot === -1 ? 0 : value.length - dot - 1
}

const minorAt = (value: string, scale: number): bigint => {
  const [whole = '0', fraction = ''] = value.split('.')
  const scaleFactor = 10n ** BigInt(scale)
  return (
    BigInt(whole) * scaleFactor +
    BigInt(fraction.length > 0 ? fraction.padEnd(scale, '0') : '0')
  )
}

/** `left >= right`, comparing decimal strings with `BigInt` only. */
const reached = (left: Amount, right: Amount): boolean => {
  const scale = Math.max(decimalPlaces(left.value), decimalPlaces(right.value))
  return minorAt(left.value, scale) >= minorAt(right.value, scale)
}

/** Maps `items` with a bounded number of concurrent workers, preserving order. */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export function createTransactionsService(
  deps: TransactionsServiceDeps
): TransactionsService {
  const { payments, gateway, statusService, merchants, now, logger } = deps
  const refreshConcurrency = deps.refreshConcurrency ?? 5

  const iso = (): string => new Date(now()).toISOString()

  const invalidCursor = (): AppError =>
    new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor')

  /** Refreshes a `PENDING` payment request against Open Payments. */
  const refreshRequest = async (request: PaymentRequest): Promise<PaymentRequest> => {
    if (request.status !== 'PENDING') return request

    if (Date.parse(request.expiresAt) <= now()) {
      try {
        return await payments.updatePaymentRequest(
          request.id,
          { status: 'EXPIRED', updatedAt: iso() },
          { expectedStatus: 'PENDING' }
        )
      } catch (error) {
        if (error instanceof ConflictError) {
          return (await payments.getPaymentRequest(request.id)) ?? request
        }
        throw error
      }
    }

    let completed: boolean
    try {
      const incoming = await gateway.getIncomingPayment(request.incomingPaymentUrl)
      completed =
        incoming.completed ||
        (incoming.incomingAmount !== undefined &&
          reached(incoming.receivedAmount, incoming.incomingAmount))
    } catch (error) {
      logger?.warn(
        { requestId: request.id, err: error },
        'Failed to refresh payment request'
      )
      return request
    }

    if (!completed) return request
    try {
      return await payments.updatePaymentRequest(
        request.id,
        { status: 'COMPLETED', updatedAt: iso() },
        { expectedStatus: 'PENDING' }
      )
    } catch (error) {
      if (error instanceof ConflictError) {
        return (await payments.getPaymentRequest(request.id)) ?? request
      }
      throw error
    }
  }

  const resolveCounterparty = async (
    payment: Payment,
    direction: TransactionDirection
  ): Promise<TransactionItem['counterparty']> => {
    const walletAddress =
      direction === 'outgoing'
        ? payment.receiverWalletAddress
        : payment.senderWalletAddress

    const merchant = await merchants.findByWallet(walletAddress)
    if (merchant !== null) {
      return { name: merchant.name, walletAddress, merchantId: merchant.id }
    }

    let name: string | null = null
    try {
      const wallet = await gateway.getWalletAddress(walletAddress)
      name = wallet.publicName ?? null
    } catch (error) {
      logger?.warn({ walletAddress, err: error }, 'Failed to resolve wallet address')
    }
    return { name, walletAddress, merchantId: null }
  }

  const toItem = async (item: Item, user: User): Promise<TransactionItem> => {
    if (!isPayment(item)) {
      return {
        id: item.id,
        kind: 'payment-request',
        direction: 'incoming',
        type: item.type,
        status: item.status,
        counterparty: null,
        debitAmount: null,
        receiveAmount: item.amount ?? null,
        fee: null,
        totalDebit: null,
        description: item.description ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }
    }

    const direction: TransactionDirection =
      item.senderWalletAddress === user.walletAddress ? 'outgoing' : 'incoming'

    return {
      id: item.id,
      kind: 'payment',
      direction,
      type: item.type,
      status: item.status,
      counterparty: await resolveCounterparty(item, direction),
      debitAmount: item.quote.debitAmount,
      receiveAmount: item.quote.receiveAmount,
      fee: {
        value: item.fee.value,
        assetCode: item.fee.assetCode,
        percentage: item.feePercentage
      },
      totalDebit: item.totalDebit,
      description: item.description ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }
  }

  /** Refreshes one list element and maps it to the API contract. */
  const processItem = async (item: Item, user: User): Promise<TransactionItem> => {
    let refreshed: Item = item
    if (isPayment(item)) {
      if (!FINAL_PAYMENT_STATUSES.has(item.status) && item.userId === user.id) {
        refreshed = (await statusService.refresh(item)).payment
      }
    } else {
      refreshed = await refreshRequest(item)
    }
    return toItem(refreshed, user)
  }

  async function list(
    user: User,
    query: ListTransactionsQuery
  ): Promise<{ items: TransactionItem[]; nextCursor: string | null }> {
    let page: { items: Item[]; nextCursor?: string }
    try {
      page = await payments.listByWallet({
        walletAddress: user.walletAddress,
        direction: query.direction,
        kind: query.kind,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor
      })
    } catch (error) {
      if (error instanceof SyntaxError) throw invalidCursor()
      throw error
    }

    const items = await mapWithConcurrency(page.items, refreshConcurrency, (item) =>
      processItem(item, user)
    )

    return { items, nextCursor: page.nextCursor ?? null }
  }

  return { list }
}
