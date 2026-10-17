import { describe, expect, it } from 'vitest'
import { createOpenPaymentsStatusChecker } from '../../src/modules/admin/home-summary.js'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import { AppError } from '../../src/shared/errors/app-error.js'

const WALLET_URL = 'https://wallet.platform.test/tranqui'
const wallet = {
  id: WALLET_URL,
  assetCode: 'USD',
  assetScale: 2,
  authServer: 'https://auth.platform.test',
  resourceServer: 'https://wallet.platform.test'
}

// Spec 020, estado de Open Payments (inicio).
describe('createOpenPaymentsStatusChecker', () => {
  it('conectado cuando la wallet de la plataforma responde', async () => {
    const gateway = createFakeOpenPaymentsGateway()
    gateway.addWallet(wallet)
    const checker = createOpenPaymentsStatusChecker({
      gateway,
      walletAddressUrl: WALLET_URL
    })
    expect(await checker.check()).toEqual({ connected: true })
  })

  it('desconectado con el código del error de la API, sin detalle interno', async () => {
    const gateway = createFakeOpenPaymentsGateway()
    gateway.failNext(
      'getWalletAddress',
      new AppError(503, 'OPEN_PAYMENTS_UNAVAILABLE', 'internal detail 10.0.0.1')
    )
    const checker = createOpenPaymentsStatusChecker({
      gateway,
      walletAddressUrl: WALLET_URL
    })
    expect(await checker.check()).toEqual({
      connected: false,
      error: 'OPEN_PAYMENTS_UNAVAILABLE'
    })
  })

  it('un error desconocido se reporta como OPEN_PAYMENTS_ERROR', async () => {
    const gateway = createFakeOpenPaymentsGateway()
    gateway.failNext('getWalletAddress', new Error('boom secret'))
    const checker = createOpenPaymentsStatusChecker({
      gateway,
      walletAddressUrl: WALLET_URL
    })
    expect(await checker.check()).toEqual({
      connected: false,
      error: 'OPEN_PAYMENTS_ERROR'
    })
  })

  it('si la consulta tarda más que el timeout, reporta OPEN_PAYMENTS_TIMEOUT', async () => {
    const gateway = createFakeOpenPaymentsGateway()
    gateway.getWalletAddress = () => new Promise(() => undefined)
    const checker = createOpenPaymentsStatusChecker({
      gateway,
      walletAddressUrl: WALLET_URL,
      timeoutMs: 20
    })
    expect(await checker.check()).toEqual({
      connected: false,
      error: 'OPEN_PAYMENTS_TIMEOUT'
    })
  })
})
