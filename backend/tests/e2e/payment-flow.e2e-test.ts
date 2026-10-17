import { describe, expect, it } from 'vitest'

/**
 * Caso 12 (spec 008): flujo completo contra la API desplegada y la red de prueba
 * de Open Payments. Solo corre si hay credenciales en el entorno; si no, se salta.
 *
 *   E2E_BASE_URL      URL pública de la API, sin barra final
 *   E2E_API_KEY       API key de la plataforma
 *   E2E_SESSION_TOKEN token de sesión de un usuario con la wallet ya vinculada
 *                     (el registro con passkey y la aprobación en la wallet son manuales)
 *   E2E_RECEIVER      wallet address del receptor de la red de prueba
 */
const { E2E_BASE_URL, E2E_API_KEY, E2E_SESSION_TOKEN, E2E_RECEIVER } = process.env
const configured =
  E2E_BASE_URL !== undefined &&
  E2E_API_KEY !== undefined &&
  E2E_SESSION_TOKEN !== undefined &&
  E2E_RECEIVER !== undefined

describe.skipIf(!configured)('E2E · flujo de pago en la red de prueba', () => {
  const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${E2E_BASE_URL ?? ''}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-api-key': E2E_API_KEY ?? '',
        authorization: `Bearer ${E2E_SESSION_TOKEN ?? ''}`,
        ...init.headers
      }
    })

  it('la API responde y la sesión es válida', async () => {
    expect((await api('/health')).status).toBe(200)
    const me = await api('/api/v1/me')
    expect(me.status).toBe(200)
    const allowance = await api('/api/v1/me/allowance')
    expect(allowance.status).toBe(200)
  })

  it('cotiza un pago y lo cancela (no mueve fondos)', async () => {
    const quote = await api('/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify({
        type: 'p2p',
        receiverWalletAddress: E2E_RECEIVER,
        amount: { value: '1.00', assetCode: 'USD' }
      })
    })
    expect(quote.status).toBe(201)
    const { paymentId } = (await quote.json()) as { paymentId: string }

    const status = await api(`/api/v1/payments/${paymentId}`)
    expect(status.status).toBe(200)
    expect(((await status.json()) as { status: string }).status).toBe(
      'AWAITING_CONFIRMATION'
    )

    expect(
      (await api(`/api/v1/payments/${paymentId}/cancel`, { method: 'POST' })).status
    ).toBe(204)
    const transactions = await api('/api/v1/transactions?limit=5')
    expect(transactions.status).toBe(200)
  })
})

describe.skipIf(configured)('E2E · sin credenciales', () => {
  it('se salta: define E2E_BASE_URL, E2E_API_KEY, E2E_SESSION_TOKEN y E2E_RECEIVER para correrlo', () => {
    expect(configured).toBe(false)
  })
})
