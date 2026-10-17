import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../helpers/app.js'

describe('GET /health', () => {
  // Caso 1
  it('responde 200 con { status: "ok" } sin API key', async () => {
    const res = await request(buildTestApp()).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
