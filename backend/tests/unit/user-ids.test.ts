import { describe, expect, it } from 'vitest'
import { newChallengeId, newUserId } from '../../src/shared/ids/ids.js'

describe('IDs de usuarios y challenges', () => {
  it('newUserId → usr_<ulid>', () => {
    expect(newUserId()).toMatch(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('newChallengeId → chl_<ulid>', () => {
    expect(newChallengeId()).toMatch(/^chl_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('son únicos y ordenables por tiempo', () => {
    const early = newUserId(1_000_000_000_000)
    const late = newUserId(1_000_000_000_001)
    expect(early).not.toBe(newUserId(1_000_000_000_000))
    expect(late > early).toBe(true)
  })
})
