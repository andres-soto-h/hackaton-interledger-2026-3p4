import { AppError } from '../../shared/errors/app-error.js'
import { newPaymentRequestId } from '../../shared/ids/ids.js'
import type { Amount } from '../../shared/money/types.js'
import { assertSafeWalletUrl } from '../../shared/security/wallet-url.js'
import type { SettingsProvider } from '../../shared/settings/settings-provider.js'
import { toApiError } from '../../integrations/open-payments/errors.js'
import type {
  IncomingPayment,
  OpenPaymentsGateway,
  WalletAddress
} from '../../integrations/open-payments/gateway.js'
import type { PaymentsRepository } from './payments.repository.js'
import type { PaymentRequest, PaymentType } from './payment.types.js'
import type { CreatePaymentRequestBody } from './payment-requests.schema.js'

export interface PaymentRequestsServiceDependencies {
  gateway: OpenPaymentsGateway
  repository: PaymentsRepository
  settings: SettingsProvider
  now?: () => Date
}

export interface CreatePaymentRequestResponse {
  id: string
  type: PaymentType
  incomingPaymentUrl: string
  receiverWalletAddress: string
  amount?: Amount
  receivedAmount: Amount
  description?: string
  status: 'PENDING'
  expiresAt: string
  createdAt: string
}

export interface PaymentRequestsService {
  create(input: CreatePaymentRequestBody): Promise<CreatePaymentRequestResponse>
}

const asApiError = (error: unknown, operation: keyof OpenPaymentsGateway): AppError =>
  error instanceof AppError ? error : toApiError(error, operation)

/**
 * Creates an incoming payment on the receiver's wallet and stores the request
 * (spec 006). Fails before any side effect when the wallet URL is unsafe, the
 * wallet is unknown or the amount's currency differs from the wallet's.
 */
export function createPaymentRequestsService({
  gateway,
  repository,
  settings,
  now = () => new Date()
}: PaymentRequestsServiceDependencies): PaymentRequestsService {
  const create = async (
    input: CreatePaymentRequestBody
  ): Promise<CreatePaymentRequestResponse> => {
    const { walletProviderBaseUrl, allowedWalletHosts } = await settings.getSettings()
    const walletAddress = assertSafeWalletUrl(input.receiverWalletAddress, {
      walletProviderBaseUrl,
      allowedWalletHosts
    })

    let wallet: WalletAddress
    try {
      wallet = await gateway.getWalletAddress(walletAddress)
    } catch (error) {
      throw asApiError(error, 'getWalletAddress')
    }

    if (input.amount !== undefined && input.amount.assetCode !== wallet.assetCode) {
      throw new AppError(422, 'ASSET_MISMATCH', 'Asset code does not match the wallet')
    }

    const nowMs = now().getTime()
    const expiresAtDate = new Date(nowMs + input.expiresInSeconds * 1000)

    let incoming: IncomingPayment
    try {
      incoming = await gateway.createIncomingPayment({
        wallet,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        expiresAt: expiresAtDate,
        ...(input.description !== undefined ? { description: input.description } : {})
      })
    } catch (error) {
      throw asApiError(error, 'createIncomingPayment')
    }

    const id = newPaymentRequestId(nowMs)
    const createdAt = new Date(nowMs).toISOString()
    const expiresAt = expiresAtDate.toISOString()

    const request: PaymentRequest = {
      id,
      type: input.type,
      receiverWalletAddress: walletAddress,
      incomingPaymentUrl: incoming.id,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      status: 'PENDING',
      expiresAt,
      createdAt,
      updatedAt: createdAt
    }

    await repository.createPaymentRequest(request)

    return {
      id,
      type: input.type,
      incomingPaymentUrl: incoming.id,
      receiverWalletAddress: walletAddress,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      receivedAmount: incoming.receivedAmount,
      ...(input.description !== undefined ? { description: input.description } : {}),
      status: 'PENDING',
      expiresAt,
      createdAt
    }
  }

  return { create }
}
