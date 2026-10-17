import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors/app-error.js'
import { apiKeyAuth } from '../../src/shared/middlewares/api-key-auth.js'

const API_KEY = 'correct-api-key-0123456789'

const run = (req: { method: string; path: string; apiKey?: string | string[] }) => {
  const headers: Record<string, string | string[]> = {}
  if (req.apiKey !== undefined) headers['x-api-key'] = req.apiKey
  const next = vi.fn<(error?: unknown) => void>()
  apiKeyAuth(API_KEY)(
    { method: req.method, path: req.path, headers } as unknown as Request,
    {} as Response,
    next
  )
  return next
}

const expectUnauthorized = (next: ReturnType<typeof run>) => {
  expect(next).toHaveBeenCalledOnce()
  const error = next.mock.calls[0]?.[0]
  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
}

describe('apiKeyAuth', () => {
  // Caso 6
  it('rechaza una ruta protegida sin x-api-key', () => {
    expectUnauthorized(run({ method: 'POST', path: '/api/v1/payments' }))
  })

  // Caso 7
  it.each([
    ['valor incorrecto de la misma longitud', 'wrong---api-key-0123456789'],
    ['valor más corto', 'short'],
    ['valor más largo', `${API_KEY}-extra`],
    ['valor vacío', ''],
    ['header repetido', [API_KEY, API_KEY]]
  ])('rechaza una ruta protegida con x-api-key incorrecta (%s)', (_name, apiKey) => {
    expectUnauthorized(run({ method: 'GET', path: '/api/v1/transactions', apiKey }))
  })

  it('usa el mismo mensaje si falta la key o si es incorrecta', () => {
    const missing = run({ method: 'GET', path: '/x' }).mock.calls[0]?.[0] as AppError
    const wrong = run({ method: 'GET', path: '/x', apiKey: 'nope' }).mock
      .calls[0]?.[0] as AppError
    expect(missing.message).toBe(wrong.message)
  })

  // Caso 8
  it('deja pasar una ruta protegida con la x-api-key correcta', () => {
    const next = run({ method: 'POST', path: '/api/v1/payments', apiKey: API_KEY })

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })

  // Caso 9
  it.each(['/health', '/api/v1/auth/callback'])(
    'deja pasar GET %s sin API key',
    (path) => {
      const next = run({ method: 'GET', path })

      expect(next).toHaveBeenCalledOnce()
      expect(next).toHaveBeenCalledWith()
    }
  )

  it('exige la key en las rutas públicas con otro método', () => {
    expectUnauthorized(run({ method: 'POST', path: '/health' }))
  })
})
