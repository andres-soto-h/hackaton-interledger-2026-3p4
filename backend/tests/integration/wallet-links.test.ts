import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import { bodyOf } from '../helpers/body.js'
import { errorOf, caught } from '../helpers/errors.js'
import { captureLogs } from '../helpers/log-capture.js'
import { wallet } from '../helpers/auth-context.js'
import {
  API_BASE_URL,
  buildWalletLinksContext,
  FRONTEND_RESULT_URL,
  type WalletLinksContext
} from '../helpers/wallet-links-context.js'

interface StartBody {
  linkId: string
  authorizationUrl: string
  dailyLimit: { value: string; assetCode: string }
  expiresAt: string
}
interface StatusBody {
  linkId: string
  status: string
  isFinal: boolean
  walletVerified: boolean
  dailyLimit: { value: string; assetCode: string }
}
interface AllowanceBody {
  dailyLimit: { value: string; assetCode: string }
  spent: { value: string; assetCode: string }
  available: { value: string; assetCode: string }
  periodStart: string
  periodEnd: string
}

let ctx: WalletLinksContext
beforeEach(() => {
  ctx = buildWalletLinksContext()
})

const bearer = (token: string) => `Bearer ${token}`
const startLink = (token: string) =>
  request(ctx.app).post('/api/v1/me/wallet-link').set('authorization', bearer(token))
const callback = (query: string) => request(ctx.app).get(`/api/v1/auth/callback?${query}`)

/** Starts a link and completes the approval; returns ids and the session token. */
const linkWallet = async (walletName = 'alice') => {
  const { user, token } = await ctx.seedUser({}, walletName)
  const started = bodyOf<StartBody>(await startLink(token))
  const res = await callback(await ctx.approvalQuery(started.linkId))
  return { user, token, linkId: started.linkId, started, res }
}

// Casos 2 y 3
describe('POST /api/v1/me/wallet-link', () => {
  it('inicia la vinculación: 202, grant con límite, intervalo, identifier y nonce exactos', async () => {
    const { user, token } = await ctx.seedUser()
    const res = await startLink(token)

    expect(res.status).toBe(202)
    const body = bodyOf<StartBody>(res)
    expect(body.linkId).toMatch(/^wl_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(body.dailyLimit).toEqual({ value: '200.00', assetCode: 'USD' })
    expect(body.authorizationUrl).toMatch(
      /^https:\/\/auth\.interledger-test\.dev\/interact\//
    )
    expect(new Date(body.expiresAt).getTime()).toBe(
      Date.parse('2026-10-17T10:10:00.000Z')
    )

    const [request1] = ctx.gateway.grantRequests()
    expect(request1?.sender.id).toBe(wallet('alice').id)
    expect(request1?.limits).toEqual({
      debitAmount: { value: '200.00', assetCode: 'USD' },
      interval: 'R/2026-10-17T05:00:00Z/P1D'
    })
    expect(request1?.finishUri).toBe(
      `${API_BASE_URL}/api/v1/auth/callback?linkId=${body.linkId}`
    )
    expect(request1?.clientNonce.length).toBeGreaterThanOrEqual(16)

    const stored = await ctx.links.get(body.linkId)
    expect(stored).toMatchObject({
      userId: user.id,
      status: 'PENDING_AUTHORIZATION',
      assetCode: 'USD',
      assetScale: 2,
      dailyLimit: '200.00',
      periodTimezone: 'America/Bogota',
      authorization: { clientNonce: request1?.clientNonce }
    })
    expect(stored?.tokenCiphertext).toBeUndefined()
  })

  it('no requiere la API key, pero sí la sesión', async () => {
    const res = await request(ctx.app).post('/api/v1/me/wallet-link')
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('SESSION_INVALID')
  })

  it('con una vinculación ACTIVE → 409 WALLET_ALREADY_LINKED', async () => {
    const { token } = await linkWallet()
    const res = await startLink(token)
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('WALLET_ALREADY_LINKED')
  })

  it('moneda sin monto diario configurado → 422 CURRENCY_NOT_SUPPORTED', async () => {
    const { token } = await ctx.seedUser({}, 'euro')
    const res = await startLink(token)
    expect(res.status).toBe(422)
    expect(errorOf(res).code).toBe('CURRENCY_NOT_SUPPORTED')
    expect(ctx.gateway.grantRequests()).toHaveLength(0)
  })

  it('tras un rechazo o vencimiento se puede iniciar otra vinculación', async () => {
    const { token } = await ctx.seedUser()
    const first = bodyOf<StartBody>(await startLink(token))
    await callback(`linkId=${first.linkId}&result=grant_rejected`)
    const second = await startLink(token)
    expect(second.status).toBe(202)
    expect(bodyOf<StartBody>(second).linkId).not.toBe(first.linkId)
  })
})

// Caso 4
describe('GET /api/v1/auth/callback · aprobación', () => {
  it('guarda el token cifrado, pasa a ACTIVE y redirige al frontend', async () => {
    const { token, linkId, res } = await linkWallet()

    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe(
      `${FRONTEND_RESULT_URL}?linkId=${linkId}&status=ACTIVE`
    )

    const stored = await ctx.links.get(linkId)
    expect(stored?.status).toBe('ACTIVE')
    expect(stored?.authorization).toBeUndefined()
    expect(stored?.tokenVersion).toBe(1)
    expect(stored?.tokenCiphertext).toBeTruthy()
    const accessToken = await ctx.service.getUsableToken(linkId)
    expect(stored?.tokenCiphertext).not.toContain(accessToken)
    expect(ctx.cipher.decrypt(stored?.tokenCiphertext ?? '', linkId)).toContain(
      accessToken
    )

    const status = await request(ctx.app)
      .get('/api/v1/me/wallet-link')
      .set('authorization', bearer(token))
    expect(bodyOf<StatusBody>(status)).toMatchObject({
      linkId,
      status: 'ACTIVE',
      isFinal: true,
      walletVerified: true
    })
  })

  it('sin FRONTEND_RESULT_URL responde una página HTML provisional', async () => {
    ctx = buildWalletLinksContext({ frontendResultUrl: null })
    const { res } = await linkWallet()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('ACTIVE')
  })

  it('nunca redirige a una URL recibida en la petición', async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    const query = await ctx.approvalQuery(started.linkId)
    const res = await callback(
      `${query}&redirect=https://evil.example&redirect_uri=https://evil.example`
    )
    expect(String(res.headers['location'])).toMatch(/^https:\/\/app\.example\.test\//)
  })
})

// Caso 5
describe('GET /api/v1/auth/callback · validaciones', () => {
  const startPending = async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    return { token, linkId: started.linkId }
  }
  const expectNoToken = async (linkId: string) => {
    const stored = await ctx.links.get(linkId)
    expect(stored?.tokenCiphertext).toBeUndefined()
  }

  it('vinculación inexistente → 404 LINK_NOT_FOUND', async () => {
    const res = await callback('linkId=wl_missing&interact_ref=r&hash=h')
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('LINK_NOT_FOUND')
  })

  it('hash alterado → 400 CALLBACK_INVALID, sin cambios y sin token', async () => {
    const { linkId } = await startPending()
    const res = await callback(`linkId=${linkId}&interact_ref=ref-1&hash=AAAAAAAA`)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('CALLBACK_INVALID')
    expect((await ctx.links.get(linkId))?.status).toBe('PENDING_AUTHORIZATION')
    await expectNoToken(linkId)
  })

  it.each(['interact_ref', 'hash'])(
    'falta %s → 400 CALLBACK_INVALID',
    async (missing) => {
      const { linkId } = await startPending()
      const full = await ctx.approvalQuery(linkId)
      const query = full
        .split('&')
        .filter((part) => !part.startsWith(`${missing}=`))
        .join('&')
      const res = await callback(query)
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('CALLBACK_INVALID')
    }
  )

  it('callback repetido → 409 CALLBACK_ALREADY_USED y no vuelve a continuar el grant', async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    const query = await ctx.approvalQuery(started.linkId)
    const continueSpy = vi.spyOn(ctx.gateway, 'continueGrant')
    expect((await callback(query)).status).toBe(302)
    const again = await callback(query.replace(/hash=[^&]*/, 'hash=x'))
    expect(again.status).toBe(409)
    expect(errorOf(again).code).toBe('CALLBACK_ALREADY_USED')
    expect(continueSpy).toHaveBeenCalledTimes(1)
  })

  it('dos callbacks válidos en paralelo: solo uno continúa el grant', async () => {
    const { linkId } = await startPending()
    const query = await ctx.approvalQuery(linkId)
    const continueSpy = vi.spyOn(ctx.gateway, 'continueGrant')
    const [a, b] = await Promise.all([callback(query), callback(query)])
    expect([a.status, b.status].sort()).toEqual([302, 409])
    expect(continueSpy).toHaveBeenCalledTimes(1)
    expect((await ctx.links.get(linkId))?.status).toBe('ACTIVE')
  })

  it('vencido (más de 10 minutos) → 410 AUTHORIZATION_EXPIRED y la vinculación queda EXPIRED', async () => {
    const { linkId } = await startPending()
    const query = await ctx.approvalQuery(linkId)
    ctx.advanceSeconds(601)
    const res = await callback(query)
    expect(res.status).toBe(410)
    expect(errorOf(res).code).toBe('AUTHORIZATION_EXPIRED')
    expect((await ctx.links.get(linkId))?.status).toBe('EXPIRED')
    await expectNoToken(linkId)
  })

  it('rechazado en la wallet (result=grant_rejected) → REJECTED y redirección', async () => {
    const { linkId } = await startPending()
    const res = await callback(`linkId=${linkId}&result=grant_rejected`)
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe(
      `${FRONTEND_RESULT_URL}?linkId=${linkId}&status=REJECTED`
    )
    expect((await ctx.links.get(linkId))?.status).toBe('REJECTED')
    await expectNoToken(linkId)
  })

  it('el grant no quedó finalizado → 409 GRANT_NOT_FINALIZED y REJECTED', async () => {
    const { linkId } = await startPending()
    ctx.gateway.failNext(
      'continueGrant',
      new AppError(409, 'GRANT_NOT_FINALIZED', 'Grant not finalized')
    )
    const res = await callback(await ctx.approvalQuery(linkId))
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('GRANT_NOT_FINALIZED')
    expect((await ctx.links.get(linkId))?.status).toBe('REJECTED')
    await expectNoToken(linkId)
  })
})

// Caso 6
describe('GET /api/v1/auth/callback · límites concedidos', () => {
  it('límites distintos a los pedidos → grant cancelado y 409 GRANT_LIMITS_MISMATCH', async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    ctx.gateway.overrideNextGrantedLimits({
      debitAmount: { value: '999.00', assetCode: 'USD' },
      interval: 'R/2026-10-17T05:00:00Z/P1D'
    })
    const res = await callback(await ctx.approvalQuery(started.linkId))

    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('GRANT_LIMITS_MISMATCH')
    const stored = await ctx.links.get(started.linkId)
    expect(stored?.status).toBe('REJECTED')
    expect(stored?.tokenCiphertext).toBeUndefined()
    expect(ctx.gateway.cancelledGrants()).toEqual([stored?.continueToken])
  })

  it('intervalo distinto al pedido también se rechaza', async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    ctx.gateway.overrideNextGrantedLimits({
      debitAmount: { value: '200.00', assetCode: 'USD' },
      interval: 'R/2026-10-17T05:00:00Z/P30D'
    })
    const res = await callback(await ctx.approvalQuery(started.linkId))
    expect(errorOf(res).code).toBe('GRANT_LIMITS_MISMATCH')
  })
})

describe('GET /api/v1/me/wallet-link', () => {
  it('pendiente: isFinal=false, Retry-After y walletVerified=false', async () => {
    const { token } = await ctx.seedUser()
    const started = bodyOf<StartBody>(await startLink(token))
    const res = await request(ctx.app)
      .get('/api/v1/me/wallet-link')
      .set('authorization', bearer(token))
    expect(res.status).toBe(200)
    expect(bodyOf<StatusBody>(res)).toMatchObject({
      linkId: started.linkId,
      status: 'PENDING_AUTHORIZATION',
      isFinal: false,
      walletVerified: false,
      dailyLimit: { value: '200.00', assetCode: 'USD' }
    })
    expect(res.headers['retry-after']).toBeTruthy()
  })

  it('sin ninguna vinculación → 404 LINK_NOT_FOUND', async () => {
    const { token } = await ctx.seedUser()
    const res = await request(ctx.app)
      .get('/api/v1/me/wallet-link')
      .set('authorization', bearer(token))
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('LINK_NOT_FOUND')
  })

  it('no muestra la vinculación de otro usuario', async () => {
    await linkWallet('alice')
    const bob = await ctx.seedUser({}, 'bob')
    const res = await request(ctx.app)
      .get('/api/v1/me/wallet-link')
      .set('authorization', bearer(bob.token))
    expect(res.status).toBe(404)
  })
})

// Caso 8 y 9
describe('token de la vinculación', () => {
  it('con el token vigente no rota', async () => {
    const { linkId } = await linkWallet()
    const rotate = vi.spyOn(ctx.gateway, 'rotateToken')
    await ctx.service.getUsableToken(linkId)
    expect(rotate).not.toHaveBeenCalled()
  })

  it('por vencer (menos de 60 s) con dos usos en paralelo: una sola rotación y el mismo token nuevo', async () => {
    ctx = buildWalletLinksContext({ tokenTtlSeconds: 30 })
    const { linkId } = await linkWallet()
    const before = await ctx.links.get(linkId)
    const rotate = vi.spyOn(ctx.gateway, 'rotateToken')

    const [a, b] = await Promise.all([
      ctx.service.getUsableToken(linkId),
      ctx.service.getUsableToken(linkId)
    ])

    expect(rotate).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    const after = await ctx.links.get(linkId)
    expect(after?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1)
    expect(after?.tokenCiphertext).not.toBe(before?.tokenCiphertext)
  })

  const makeQuote = async () => {
    const sender = wallet('alice')
    const incoming = await ctx.gateway.createIncomingPayment({
      wallet: wallet('shop'),
      amount: { value: '5.00', assetCode: 'USD' },
      expiresAt: new Date('2026-10-17T11:00:00Z')
    })
    return ctx.gateway.createQuote({ sender, receiver: incoming.id })
  }

  it('401 al usar el token → rota una vez y reintenta con el token nuevo', async () => {
    const { linkId } = await linkWallet()
    const quote = await makeQuote()
    ctx.gateway.invalidateAccessToken(await ctx.service.getUsableToken(linkId))
    const rotate = vi.spyOn(ctx.gateway, 'rotateToken')

    const payment = await ctx.service.withToken(linkId, (accessToken) =>
      ctx.gateway.createOutgoingPayment({
        sender: wallet('alice'),
        quoteId: quote.id,
        accessToken
      })
    )

    expect(payment.quoteId).toBe(quote.id)
    expect(rotate).toHaveBeenCalledTimes(1)
  })

  it('si el reintento también da 401, falla sin rotar otra vez', async () => {
    const { linkId } = await linkWallet()
    const rotate = vi.spyOn(ctx.gateway, 'rotateToken')
    const error = await caught(() =>
      ctx.service.withToken(linkId, () =>
        Promise.reject(new AppError(502, 'OPEN_PAYMENTS_UNAUTHORIZED', 'rejected'))
      )
    )
    expect(error).toMatchObject({ code: 'OPEN_PAYMENTS_UNAUTHORIZED' })
    expect(rotate).toHaveBeenCalledTimes(1)
  })

  it('otros errores no provocan rotación', async () => {
    const { linkId } = await linkWallet()
    const rotate = vi.spyOn(ctx.gateway, 'rotateToken')
    const error = await caught(() =>
      ctx.service.withToken(linkId, () =>
        Promise.reject(new AppError(502, 'OPEN_PAYMENTS_ERROR', 'boom'))
      )
    )
    expect(error).toMatchObject({ code: 'OPEN_PAYMENTS_ERROR' })
    expect(rotate).not.toHaveBeenCalled()
  })

  it('grant revocado desde la wallet → REVOKED y WALLET_LINK_REVOKED (409)', async () => {
    ctx = buildWalletLinksContext({ tokenTtlSeconds: 30 })
    const { linkId, token } = await linkWallet()
    ctx.gateway.revokeGrants()

    const error = await caught(() => ctx.service.getUsableToken(linkId))
    expect(error).toMatchObject({ status: 409, code: 'WALLET_LINK_REVOKED' })
    const stored = await ctx.links.get(linkId)
    expect(stored?.status).toBe('REVOKED')
    expect(stored?.tokenCiphertext).toBeUndefined()

    const status = await request(ctx.app)
      .get('/api/v1/me/wallet-link')
      .set('authorization', bearer(token))
    expect(bodyOf<StatusBody>(status).status).toBe('REVOKED')
  })
})

// Caso 11 y reservas
describe('monto diario', () => {
  const usd = (value: string) => ({ value, assetCode: 'USD' })
  const allowance = (token: string) =>
    request(ctx.app).get('/api/v1/me/allowance').set('authorization', bearer(token))

  it('GET /me/allowance sin gasto: todo disponible y periodo de Bogotá', async () => {
    const { token } = await linkWallet()
    const res = await allowance(token)
    expect(res.status).toBe(200)
    expect(bodyOf<AllowanceBody>(res)).toEqual({
      dailyLimit: usd('200.00'),
      spent: usd('0.00'),
      available: usd('200.00'),
      periodStart: '2026-10-17T05:00:00.000Z',
      periodEnd: '2026-10-18T05:00:00.000Z'
    })
  })

  it('con gasto reservado, descuenta del disponible; al liberar, lo devuelve', async () => {
    const { token, linkId } = await linkWallet()
    await ctx.service.reserve(linkId, usd('25.50'))
    expect(bodyOf<AllowanceBody>(await allowance(token))).toMatchObject({
      spent: usd('25.50'),
      available: usd('174.50')
    })
    await ctx.service.release(linkId, usd('25.50'))
    expect(bodyOf<AllowanceBody>(await allowance(token)).available).toEqual(usd('200.00'))
  })

  it('al cambiar el día (medianoche de Bogotá) el gasto vuelve a 0', async () => {
    const { token, linkId } = await linkWallet()
    await ctx.service.reserve(linkId, usd('100.00'))
    ctx.advanceSeconds(19 * 3600) // 2026-10-18T05:00:00Z = 00:00 en Bogotá
    const body = bodyOf<AllowanceBody>(await allowance(token))
    expect(body.spent).toEqual(usd('0.00'))
    expect(body.periodStart).toBe('2026-10-18T05:00:00.000Z')
  })

  it('un gasto que supera el disponible → 422 DAILY_LIMIT_EXCEEDED sin llamar a Open Payments', async () => {
    const { linkId } = await linkWallet()
    await ctx.service.reserve(linkId, usd('150.00'))
    const spies = [
      vi.spyOn(ctx.gateway, 'createQuote'),
      vi.spyOn(ctx.gateway, 'createOutgoingPayment'),
      vi.spyOn(ctx.gateway, 'rotateToken')
    ]
    const error = await caught(() => ctx.service.reserve(linkId, usd('50.01')))
    expect(error).toMatchObject({ status: 422, code: 'DAILY_LIMIT_EXCEEDED' })
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    await expect(ctx.service.reserve(linkId, usd('50.00'))).resolves.toBeUndefined()
  })

  it('dos reservas en paralelo que juntas superan el límite: solo una lo logra', async () => {
    const { linkId } = await linkWallet()
    const results = await Promise.allSettled([
      ctx.service.reserve(linkId, usd('150.00')),
      ctx.service.reserve(linkId, usd('150.00'))
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('la moneda del gasto debe ser la de la vinculación', async () => {
    const { linkId } = await linkWallet()
    const error = await caught(() =>
      ctx.service.reserve(linkId, { value: '1.00', assetCode: 'MXN' })
    )
    expect(error).toMatchObject({ code: 'CURRENCY_NOT_SUPPORTED' })
  })

  it('sin vinculación ACTIVE → 403 WALLET_NOT_LINKED', async () => {
    const { token } = await ctx.seedUser()
    const res = await allowance(token)
    expect(res.status).toBe(403)
    expect(errorOf(res).code).toBe('WALLET_NOT_LINKED')

    const started = bodyOf<StartBody>(await startLink(token))
    const error = await caught(() => ctx.service.reserve(started.linkId, usd('1.00')))
    expect(error).toMatchObject({ status: 403, code: 'WALLET_NOT_LINKED' })
  })
})

// Caso 12
describe('desvincular', () => {
  const unlink = (token: string) =>
    request(ctx.app).delete('/api/v1/me/wallet-link').set('authorization', bearer(token))

  it('con sesión reciente: cancela el grant, borra el token y queda REVOKED', async () => {
    const { token, linkId } = await linkWallet()
    const continueToken = (await ctx.links.get(linkId))?.continueToken

    const res = await unlink(token)
    expect(res.status).toBe(204)
    expect(ctx.gateway.cancelledGrants()).toEqual([continueToken])
    const stored = await ctx.links.get(linkId)
    expect(stored?.status).toBe('REVOKED')
    expect(stored?.tokenCiphertext).toBeUndefined()
    expect(stored?.revokedAt).toBeTruthy()
  })

  it('con una sesión de más de 5 minutos pide volver a autenticar (401 REAUTH_REQUIRED)', async () => {
    const { token, linkId } = await linkWallet()
    ctx.advanceSeconds(301)
    const res = await unlink(token)
    expect(res.status).toBe(401)
    expect(errorOf(res).code).toBe('REAUTH_REQUIRED')
    expect((await ctx.links.get(linkId))?.status).toBe('ACTIVE')
    expect(ctx.gateway.cancelledGrants()).toHaveLength(0)
  })

  it('sin vinculación ACTIVE → 404 LINK_NOT_FOUND', async () => {
    const { token } = await ctx.seedUser()
    const res = await unlink(token)
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('LINK_NOT_FOUND')
  })

  it('después de desvincular se puede vincular otra vez', async () => {
    const { token } = await linkWallet()
    await unlink(token)
    expect((await startLink(token)).status).toBe(202)
  })

  it('si Open Payments falla al cancelar, igual queda REVOKED y sin token', async () => {
    const { token, linkId } = await linkWallet()
    ctx.gateway.failNext('cancelGrant', new AppError(502, 'OPEN_PAYMENTS_ERROR', 'boom'))
    const res = await unlink(token)
    expect(res.status).toBe(204)
    const stored = await ctx.links.get(linkId)
    expect(stored?.status).toBe('REVOKED')
    expect(stored?.tokenCiphertext).toBeUndefined()
  })

  it('al borrar la cuenta (DELETE /me) se cancela el grant y se borra el token', async () => {
    const { token, linkId } = await linkWallet()
    const continueToken = (await ctx.links.get(linkId))?.continueToken

    const res = await request(ctx.app)
      .delete('/api/v1/me')
      .set('authorization', bearer(token))
    expect(res.status).toBe(204)
    expect(ctx.gateway.cancelledGrants()).toEqual([continueToken])
    const stored = await ctx.links.get(linkId)
    expect(stored?.status).toBe('REVOKED')
    expect(stored?.tokenCiphertext).toBeUndefined()
  })

  it('borrar una cuenta sin vinculación sigue funcionando', async () => {
    const { token } = await ctx.seedUser()
    const res = await request(ctx.app)
      .delete('/api/v1/me')
      .set('authorization', bearer(token))
    expect(res.status).toBe(204)
  })
})

// Caso 13
describe('el token nunca se expone', () => {
  it('no aparece en respuestas ni en logs durante el flujo completo', async () => {
    const { logger, text } = captureLogs()
    ctx = buildWalletLinksContext({ logger, tokenTtlSeconds: 30 })

    const { token, linkId, started, res } = await linkWallet()
    const responses: string[] = [
      JSON.stringify(started),
      res.text,
      JSON.stringify(res.headers)
    ]
    for (const path of ['/api/v1/me/wallet-link', '/api/v1/me/allowance', '/api/v1/me']) {
      const r = await request(ctx.app).get(path).set('authorization', bearer(token))
      responses.push(r.text, JSON.stringify(r.headers))
    }
    const accessToken = await ctx.service.getUsableToken(linkId) // fuerza una rotación
    const stored = await ctx.links.get(linkId)
    const manageUrl = JSON.parse(
      ctx.cipher.decrypt(stored?.tokenCiphertext ?? '', linkId)
    ) as {
      manageUrl?: string
    }

    const everything = [...responses, text()].join('\n')
    expect(everything).not.toContain(accessToken)
    if (manageUrl.manageUrl !== undefined)
      expect(everything).not.toContain(manageUrl.manageUrl)
    expect(everything).not.toContain(stored?.continueToken ?? 'continue-token-missing')
  })
})
