import { generateKeyPairSync } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createOpenPaymentsGateway } from '../../src/integrations/open-payments/adapter.js'
import { caught } from '../helpers/errors.js'
import {
  accessTokenBody,
  KEY_ID,
  PLATFORM_WALLET_URL
} from '../fixtures/open-payments.js'

const server = setupServer()
const CONTINUE = 'https://auth.sender.test/continue/c1'

const outgoingAccess = (limits: Record<string, unknown>) => [
  {
    type: 'outgoing-payment',
    actions: ['create', 'read'],
    identifier: 'https://wallet.sender.test/alice',
    limits
  }
]

// Spec 023, tarea 2: el adapter expone los límites concedidos por el auth server.
describe('Open Payments adapter · límites concedidos', () => {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  afterAll(() => server.close())
  afterEach(() => server.resetHandlers())

  const gateway = () =>
    createOpenPaymentsGateway({
      walletAddressUrl: PLATFORM_WALLET_URL,
      keyId: KEY_ID,
      privateKey: generateKeyPairSync('ed25519').privateKey,
      timeoutMs: 500,
      retryBaseDelayMs: 1
    })

  it('continueGrant devuelve debitAmount e interval concedidos en unidades decimales', async () => {
    server.use(
      http.post(CONTINUE, () =>
        HttpResponse.json({
          access_token: accessTokenBody(
            'out-token',
            'https://auth.sender.test/token/t3',
            outgoingAccess({
              debitAmount: { value: '20000', assetCode: 'USD', assetScale: 2 },
              interval: 'R/2026-10-17T05:00:00Z/P1D'
            })
          ),
          continue: {
            access_token: { value: 'c2' },
            uri: 'https://auth.sender.test/continue/c2'
          }
        })
      )
    )
    const result = await (
      await gateway()
    ).continueGrant({
      continueUri: CONTINUE,
      continueToken: 'continue-token',
      interactRef: 'ref-1'
    })
    expect(result.grantedLimits).toEqual({
      debitAmount: { value: '200.00', assetCode: 'USD' },
      interval: 'R/2026-10-17T05:00:00Z/P1D'
    })
  })

  it('rotateToken devuelve el vencimiento del token nuevo', async () => {
    server.use(
      http.post('https://auth.sender.test/token/t3', () =>
        HttpResponse.json({
          access_token: accessTokenBody(
            'new-token',
            'https://auth.sender.test/token/t4',
            outgoingAccess({
              debitAmount: { value: '20000', assetCode: 'USD', assetScale: 2 },
              interval: 'R/2026-10-17T05:00:00Z/P1D'
            }),
            600
          )
        })
      )
    )
    const result = await (
      await gateway()
    ).rotateToken({
      manageUrl: 'https://auth.sender.test/token/t3',
      accessToken: 'out-token'
    })
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('un grant que sigue pendiente (sin access_token) → GRANT_NOT_FINALIZED', async () => {
    server.use(
      http.post(CONTINUE, () =>
        HttpResponse.json({
          continue: {
            access_token: { value: 'c2' },
            uri: 'https://auth.sender.test/continue/c2',
            wait: 5
          }
        })
      )
    )
    const error = await caught(async () =>
      (await gateway()).continueGrant({
        continueUri: CONTINUE,
        continueToken: 'continue-token',
        interactRef: 'ref-1'
      })
    )
    expect(error).toMatchObject({ status: 409, code: 'GRANT_NOT_FINALIZED' })
  })

  it('un 401 al rotar el token → GRANT_REVOKED', async () => {
    server.use(
      http.post('https://auth.sender.test/token/t3', () =>
        HttpResponse.json({ error: 'invalid_token' }, { status: 401 })
      )
    )
    const error = await caught(async () =>
      (await gateway()).rotateToken({
        manageUrl: 'https://auth.sender.test/token/t3',
        accessToken: 'out-token'
      })
    )
    expect(error).toMatchObject({ status: 409, code: 'GRANT_REVOKED' })
  })
})
