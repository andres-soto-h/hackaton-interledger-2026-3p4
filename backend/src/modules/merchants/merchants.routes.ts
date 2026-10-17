import { Router } from 'express'
import type { SessionService } from '../../shared/session/session.service.js'
import { userAuth } from '../../shared/middlewares/user-auth.js'
import type { UsersRepository } from '../users/users.repository.js'

interface Merchant {
  id: string
  name: string
  walletAddress: string
  assetCode: string
  assetScale: number
  fixedAmount: string | null
}

// Static merchant directory (spec 024): no Open Payments SDK involved.
const MERCHANTS: Merchant[] = [
  {
    id: 'mer_epm',
    name: 'EPM',
    walletAddress: 'https://ilp.interledger-test.dev/epm',
    assetCode: 'COP',
    assetScale: 2,
    fixedAmount: '200000.00'
  },
  {
    id: 'mer_claro',
    name: 'Claro',
    walletAddress: 'https://ilp.interledger-test.dev/claro_recaudo',
    assetCode: 'COP',
    assetScale: 2,
    fixedAmount: '120000.00'
  },
  {
    id: 'mer_don_luis',
    name: 'Tienda don Luis',
    walletAddress: 'https://ilp.interledger-test.dev/andy_pesos',
    assetCode: 'COP',
    assetScale: 2,
    fixedAmount: null
  }
]

export function createMerchantsRouter(deps: {
  sessions: SessionService
  users: UsersRepository
}): Router {
  const router = Router()

  router.get('/api/v1/merchants', userAuth({ sessions: deps.sessions, users: deps.users }), (_req, res) => {
    res.status(200).json({ items: MERCHANTS })
  })

  return router
}
