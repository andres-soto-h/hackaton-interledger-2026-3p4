import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeOpenPaymentsGateway } from '../../src/integrations/open-payments/fake-gateway.js'
import type { WalletAddress } from '../../src/integrations/open-payments/gateway.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { caught } from '../helpers/errors.js'

const NOW = new Date('2026-10-17T10:00:00.000Z')
const alice: WalletAddress = {
  id: 'https://ilp.interledger-test.dev/alice',
  publicName: 'alice',
  assetCode: 'USD',
  assetScale: 2,
  authServer: 'https://auth.interledger-test.dev',
  resourceServer: 'https://ilp.interledger-test.dev'
}
const limits = {
  debitAmount: { value: '200.00', assetCode: 'USD' },
  interval: 'R/2026-10-17T05:00:00Z/P1D'
}

// Spec 023, tarea 2: extensiones del puerto y del fake para vincular wallets.
describe('FakeOpenPaymentsGateway · grants con límites (spec 023)', () => {
  let fake: ReturnType<typeof createFakeOpenPaymentsGateway>

  beforeEach(() => {
    fake = createFakeOpenPaymentsGateway({ now: () => NOW, tokenTtlSeconds: 600 })
    fake.addWallet(alice)
  })

  const link = async () => {
    const pending = await fake.requestOutgoingPaymentGrant({
      sender: alice,
      limits,
      finishUri: 'https://api.example.test/api/v1/auth/callback?linkId=wl_1',
      clientNonce: 'client-nonce-1'
    })
    const result = await fake.continueGrant({
      continueUri: pending.continueUri,
      continueToken: pending.continueToken,
      interactRef: 'ref-1'
    })
    return { pending, result }
  }

  it('registra cada petición de grant con sus límites, finishUri y nonce', async () => {
    const { pending } = await link()
    expect(fake.grantRequests()).toEqual([
      {
        sender: alice,
        limits,
        finishUri: 'https://api.example.test/api/v1/auth/callback?linkId=wl_1',
        clientNonce: 'client-nonce-1',
        continueToken: pending.continueToken
      }
    ])
  })

  it('continueGrant devuelve los límites concedidos (los pedidos) y el vencimiento', async () => {
    const { result } = await link()
    expect(result.grantedLimits).toEqual(limits)
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 600_000))
  })

  it('overrideNextGrantedLimits cambia lo concedido solo en el siguiente grant', async () => {
    const other = {
      debitAmount: { value: '999.00', assetCode: 'USD' },
      interval: limits.interval
    }
    fake.overrideNextGrantedLimits(other)
    expect((await link()).result.grantedLimits).toEqual(other)
    expect((await link()).result.grantedLimits).toEqual(limits)
  })

  it('rotateToken entrega un token nuevo con vencimiento y el anterior deja de servir', async () => {
    const { result } = await link()
    const rotated = await fake.rotateToken({
      manageUrl: result.manageUrl,
      accessToken: result.accessToken
    })
    expect(rotated.accessToken).not.toBe(result.accessToken)
    expect(rotated.expiresAt).toEqual(new Date(NOW.getTime() + 600_000))
    const again = await caught(() =>
      fake.rotateToken({ manageUrl: result.manageUrl, accessToken: result.accessToken })
    )
    expect(again).toBeInstanceOf(AppError)
  })

  it('invalidateAccessToken: usarlo da OPEN_PAYMENTS_UNAUTHORIZED pero se puede rotar', async () => {
    const { result } = await link()
    fake.invalidateAccessToken(result.accessToken)
    const error = await caught(() =>
      fake.getOutgoingPayment({ url: 'https://x/y', accessToken: result.accessToken })
    )
    expect(error).toMatchObject({ status: 502, code: 'OPEN_PAYMENTS_UNAUTHORIZED' })
    const rotated = await fake.rotateToken({
      manageUrl: result.manageUrl,
      accessToken: result.accessToken
    })
    expect(rotated.accessToken).toBeTruthy()
  })

  it('revokeGrants: rotar da GRANT_REVOKED (409) y usar el token da UNAUTHORIZED', async () => {
    const { result } = await link()
    fake.revokeGrants()
    expect(
      await caught(() =>
        fake.rotateToken({ manageUrl: result.manageUrl, accessToken: result.accessToken })
      )
    ).toMatchObject({ status: 409, code: 'GRANT_REVOKED' })
    expect(
      await caught(() =>
        fake.getOutgoingPayment({ url: 'https://x/y', accessToken: result.accessToken })
      )
    ).toMatchObject({ code: 'OPEN_PAYMENTS_UNAUTHORIZED' })
  })

  it('cancelGrant queda registrado por continueToken', async () => {
    const { pending } = await link()
    await fake.cancelGrant({
      continueUri: pending.continueUri,
      continueToken: pending.continueToken
    })
    expect(fake.cancelledGrants()).toEqual([pending.continueToken])
  })
})
