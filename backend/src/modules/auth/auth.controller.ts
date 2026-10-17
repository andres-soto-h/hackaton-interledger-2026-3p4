import type { RequestHandler } from 'express'
import type { AuthService } from './auth.service.js'

export function createAuthController(service: AuthService) {
  const registerOptions: RequestHandler = async (req, res, next) => {
    try {
      const body = req.body as {
        displayName?: string
        walletAddress?: string
        enrollmentToken?: string
      }
      res.status(200).json(await service.registerOptions(body))
    } catch (error) {
      next(error)
    }
  }

  const registerVerify: RequestHandler = async (req, res, next) => {
    try {
      const body = req.body as { challengeId: string; credential: unknown }
      res.status(201).json(await service.registerVerify(body))
    } catch (error) {
      next(error)
    }
  }

  const loginOptions: RequestHandler = async (req, res, next) => {
    try {
      const body = req.body as { email?: string } | undefined
      res.status(200).json(await service.loginOptions(body ?? {}))
    } catch (error) {
      next(error)
    }
  }

  const loginVerify: RequestHandler = async (req, res, next) => {
    try {
      const body = req.body as { challengeId: string; credential: unknown }
      res.status(200).json(await service.loginVerify(body))
    } catch (error) {
      next(error)
    }
  }

  return { registerOptions, registerVerify, loginOptions, loginVerify }
}
