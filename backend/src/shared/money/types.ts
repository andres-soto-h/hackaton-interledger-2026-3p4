/** Amount as the API exchanges it: decimal string plus currency code (see API.md). */
export interface Amount {
  value: string
  assetCode: string
}

/** Side of a payment that keeps the exact amount requested (spec 003). */
export type FixedAmountSide = 'receive' | 'send'
