import type { PaymentsRepository } from '../payments/payments.repository.js'
import { summarizeFees, type FeeSummaryProvider } from './fee-summary.js'

/** `FeeSummaryProvider` for the admin panel (spec 024), computed from the stored payments. */
export function createFeeSummaryProvider({
  payments,
  now
}: {
  payments: Pick<PaymentsRepository, 'listAllPayments'>
  /** Milliseconds since the epoch. */
  now: () => number
}): FeeSummaryProvider {
  return {
    summary: async () => summarizeFees(await payments.listAllPayments(), now())
  }
}
