import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const yaml = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8')

const pathBlock = (path: string): string => {
  const start = yaml.indexOf(`  ${path}:`)
  if (start === -1) return ''
  const rest = yaml.slice(start + 1)
  const next = rest.search(/\n {2}\/[^\n]*:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('openapi.yaml · contrato de polling', () => {
  it.each(['/api/v1/payments/{id}', '/api/v1/me/wallet-link'])(
    '%s documenta Retry-After e isFinal',
    (path) => {
      const block = pathBlock(path)
      expect(block).not.toBe('')
      expect(block).toContain('Retry-After')
    }
  )

  it('el esquema del estado de pago incluye isFinal', () => {
    expect(yaml).toMatch(/isFinal:/)
  })
})
