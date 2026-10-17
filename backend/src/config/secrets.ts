/** Open Payments client credentials (same format locally and in AWS). */
export interface OpenPaymentsCredentials {
  walletAddressUrl: string
  keyId: string
  privateKey: string
}

export interface Secrets {
  apiKey: string
  openPayments: OpenPaymentsCredentials
}
