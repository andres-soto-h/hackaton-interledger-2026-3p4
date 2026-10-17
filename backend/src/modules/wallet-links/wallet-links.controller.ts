import type { RequestHandler } from 'express'
import { getSessionUser } from '../../shared/middlewares/user-auth.js'
import type { WalletLinksService } from './wallet-links.service.js'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return map[char] ?? char
  })

export function createWalletLinksController(
  service: WalletLinksService,
  frontendResultUrl?: string
) {
  const startLink: RequestHandler = async (_req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      const result = await service.start(user)
      res.status(202).json(result)
    } catch (error) {
      next(error)
    }
  }

  const getLink: RequestHandler = async (_req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      const result = await service.getLatest(user.id)
      if (result.status === 'PENDING_AUTHORIZATION') {
        res.set('Retry-After', '2')
      }
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  const unlink: RequestHandler = async (_req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      await service.unlink(user.id)
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  }

  const getAllowance: RequestHandler = async (_req, res, next) => {
    try {
      const { user } = getSessionUser(res)
      const result = await service.getAllowance(user.id)
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  }

  const callback: RequestHandler = async (req, res, next) => {
    try {
      const query = req.query as {
        linkId?: string
        interact_ref?: string
        hash?: string
        result?: string
      }
      const outcome = await service.handleCallback({
        linkId: query.linkId ?? '',
        interactRef: query.interact_ref,
        hash: query.hash,
        result: query.result
      })
      const status = outcome.status

      if (frontendResultUrl !== undefined) {
        res.redirect(
          302,
          `${frontendResultUrl}?linkId=${encodeURIComponent(outcome.linkId)}&status=${status}`
        )
        return
      }

      res
        .status(200)
        .type('html')
        .send(
          `<!doctype html><html><body><h1>Wallet link ${escapeHtml(status)}</h1></body></html>`
        )
    } catch (error) {
      next(error)
    }
  }

  return { startLink, getLink, unlink, getAllowance, callback }
}
