import type { Payment, PaymentRequest } from './payment.types.js'
import {
  ConflictError,
  type ListByWalletQuery,
  type PaymentsRepository
} from './payments.repository.js'

type Item = Payment | PaymentRequest

interface Cursor {
  createdAt: string
  id: string
}

const encodeCursor = (item: Item): string =>
  Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.id })).toString(
    'base64'
  )

const decodeCursor = (cursor: string): Cursor =>
  JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as Cursor

const isPayment = (item: Item): item is Payment => 'senderWalletAddress' in item

const matchesDirection = (
  item: Item,
  walletAddress: string,
  direction: ListByWalletQuery['direction']
): boolean => {
  switch (direction) {
    case 'outgoing':
      return isPayment(item) && item.senderWalletAddress === walletAddress
    case 'incoming':
      return item.receiverWalletAddress === walletAddress
    case 'all':
      return (
        (isPayment(item) && item.senderWalletAddress === walletAddress) ||
        item.receiverWalletAddress === walletAddress
      )
  }
}

const matchesKind = (item: Item, kind: ListByWalletQuery['kind']): boolean => {
  switch (kind) {
    case 'payment':
      return item.id.startsWith('pay_')
    case 'payment-request':
      return item.id.startsWith('pr_')
    case 'all':
      return true
  }
}

/** Newest first; on equal `createdAt`, breaks ties by descending `id`. */
const byNewestFirst = (a: Item, b: Item): number => {
  if (a.createdAt > b.createdAt) return -1
  if (a.createdAt < b.createdAt) return 1
  if (a.id > b.id) return -1
  if (a.id < b.id) return 1
  return 0
}

/** `true` if `item` sits at the cursor position or earlier in the ordering. */
const isAtOrAfter = (item: Item, cursor: Cursor): boolean => {
  if (item.createdAt > cursor.createdAt) return true
  if (item.createdAt < cursor.createdAt) return false
  return item.id >= cursor.id
}

/** In-memory implementation for local runs and tests (Lambda uses DynamoDB). */
export function createInMemoryPaymentsRepository(): PaymentsRepository {
  const payments = new Map<string, Payment>()
  const requests = new Map<string, PaymentRequest>()

  return {
    createPayment(p) {
      payments.set(p.id, structuredClone(p))
      return Promise.resolve()
    },

    getPayment(id) {
      const payment = payments.get(id)
      return Promise.resolve(payment ? structuredClone(payment) : null)
    },

    updatePayment(id, changes, opts) {
      const current = payments.get(id)
      if (!current || current.status !== opts.expectedStatus) {
        const message = !current
          ? `Payment ${id} does not exist`
          : `Unexpected status: ${current.status} (expected ${opts.expectedStatus})`
        return Promise.reject(new ConflictError(message))
      }

      const next: Payment = { ...current, ...changes }
      if (next.status !== 'AWAITING_CONFIRMATION') {
        delete next.expiresAt
      }
      payments.set(id, structuredClone(next))
      return Promise.resolve(structuredClone(next))
    },

    createPaymentRequest(r) {
      requests.set(r.id, structuredClone(r))
      return Promise.resolve()
    },

    getPaymentRequest(id) {
      const request = requests.get(id)
      return Promise.resolve(request ? structuredClone(request) : null)
    },

    updatePaymentRequest(id, changes, opts) {
      const current = requests.get(id)
      if (!current || current.status !== opts.expectedStatus) {
        const message = !current
          ? `Payment request ${id} does not exist`
          : `Unexpected status: ${current.status} (expected ${opts.expectedStatus})`
        return Promise.reject(new ConflictError(message))
      }

      const next: PaymentRequest = { ...current, ...changes }
      requests.set(id, structuredClone(next))
      return Promise.resolve(structuredClone(next))
    },

    listByWallet(q) {
      const all: Item[] = [...payments.values(), ...requests.values()]

      const matching = new Map<string, Item>()
      for (const item of all) {
        if (
          matchesDirection(item, q.walletAddress, q.direction) &&
          matchesKind(item, q.kind) &&
          (q.status === undefined || item.status === q.status)
        ) {
          matching.set(item.id, item)
        }
      }
      const sorted = [...matching.values()].sort(byNewestFirst)

      let startIndex = 0
      if (q.cursor !== undefined) {
        const cursor = decodeCursor(q.cursor)
        while (startIndex < sorted.length && isAtOrAfter(sorted[startIndex]!, cursor)) {
          startIndex++
        }
      }

      const page = sorted.slice(startIndex, startIndex + q.limit)
      const hasMore = startIndex + q.limit < sorted.length
      const items = page.map((item) => structuredClone(item))

      if (!hasMore) {
        return Promise.resolve({ items })
      }
      return Promise.resolve({ items, nextCursor: encodeCursor(page[page.length - 1]!) })
    }
  }
}
