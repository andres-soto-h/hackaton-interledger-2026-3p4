import { describe, expect, it } from 'vitest'
import { createInMemoryUsersRepository } from '../../src/modules/users/in-memory-users.repository.js'

describe('Challenge de tipo payment_confirmation (almacén en memoria)', () => {
  it('conserva el pago, el usuario y el total al consumirse, una sola vez', async () => {
    const repo = createInMemoryUsersRepository()
    const challenge = {
      id: 'chl_01JPAYPAYPAYPAYPAYPAYPAYPA',
      challenge: 'pay-challenge',
      type: 'payment_confirmation' as const,
      payment: {
        paymentId: 'pay_01JAAAAAAAAAAAAAAAAAAAAAAA',
        userId: 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA',
        totalDebit: { value: '25.38', assetCode: 'USD' }
      },
      expiresAt: 2_000_000_000
    }
    await repo.createChallenge(challenge)

    expect(await repo.consumeChallenge(challenge.id, 1_999_999_000)).toEqual(challenge)
    expect(await repo.consumeChallenge(challenge.id, 1_999_999_000)).toBeNull()
  })
})
