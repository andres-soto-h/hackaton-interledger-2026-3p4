import { describe, expect, it } from 'vitest'
import {
  currentPeriod,
  dailyInterval
} from '../../src/modules/wallet-links/allowance-period.js'

const BOGOTA = 'America/Bogota'

describe('currentPeriod (America/Bogota, UTC-5 sin horario de verano)', () => {
  it('a media mañana el periodo empieza a las 00:00 de Bogotá (05:00Z)', () => {
    const period = currentPeriod(new Date('2026-10-17T10:00:00Z'), BOGOTA)
    expect(period.start.toISOString()).toBe('2026-10-17T05:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-10-18T05:00:00.000Z')
  })

  it('a las 23:59:59 de Bogotá sigue siendo el mismo día', () => {
    const period = currentPeriod(new Date('2026-10-18T04:59:59Z'), BOGOTA)
    expect(period.start.toISOString()).toBe('2026-10-17T05:00:00.000Z')
  })

  it('a las 00:00:00 de Bogotá empieza el día siguiente', () => {
    const period = currentPeriod(new Date('2026-10-18T05:00:00Z'), BOGOTA)
    expect(period.start.toISOString()).toBe('2026-10-18T05:00:00.000Z')
  })

  it('antes de las 05:00Z todavía es el día anterior en Bogotá', () => {
    const period = currentPeriod(new Date('2026-10-17T04:59:59Z'), BOGOTA)
    expect(period.start.toISOString()).toBe('2026-10-16T05:00:00.000Z')
  })

  it('el periodo dura exactamente 24 horas', () => {
    const period = currentPeriod(new Date('2026-03-08T15:00:00Z'), BOGOTA)
    expect(period.end.getTime() - period.start.getTime()).toBe(24 * 3600 * 1000)
  })
})

describe('dailyInterval', () => {
  it('formatea R/<inicio>/P1D sin milisegundos', () => {
    expect(dailyInterval(new Date('2026-10-17T05:00:00.000Z'))).toBe(
      'R/2026-10-17T05:00:00Z/P1D'
    )
  })
})
