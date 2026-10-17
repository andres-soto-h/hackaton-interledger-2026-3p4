import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../src/shared/logger.js'

const capture = () => {
  const lines: Record<string, unknown>[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>)
      callback()
    }
  })
  return { lines, stream }
}

describe('createLogger', () => {
  it('escribe JSON estructurado respetando el nivel configurado', () => {
    const { lines, stream } = capture()
    const logger = createLogger({ logLevel: 'warn' }, stream)

    logger.info('ignored')
    logger.warn({ requestId: 'r1' }, 'something happened')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'warn',
      msg: 'something happened',
      requestId: 'r1'
    })
  })

  it('oculta API keys y llaves privadas', () => {
    const { lines, stream } = capture()
    const logger = createLogger({ logLevel: 'info' }, stream)

    logger.info({
      req: { headers: { 'x-api-key': 'secret-key' } },
      apiKey: 'secret-key',
      openPayments: { privateKey: '-----BEGIN PRIVATE KEY-----' },
      privateKey: '-----BEGIN PRIVATE KEY-----'
    })

    const serialized = JSON.stringify(lines)
    expect(serialized).not.toContain('secret-key')
    expect(serialized).not.toContain('PRIVATE KEY')
  })
})
