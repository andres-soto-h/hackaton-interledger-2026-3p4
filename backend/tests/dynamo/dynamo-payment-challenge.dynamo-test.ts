import { afterAll, describe, expect, it } from 'vitest'
import { createDynamoUsersRepository } from '../../src/modules/users/dynamo-users.repository.js'
import {
  createFullTable,
  documentClient,
  dropCreatedTables
} from '../helpers/dynamo-table.js'

afterAll(dropCreatedTables)

describe('Challenge payment_confirmation en DynamoDB Local', () => {
  it('guarda y devuelve el pago, el usuario y el total; es de un solo uso', async () => {
    const repo = createDynamoUsersRepository({
      client: documentClient,
      tableName: await createFullTable('payment-challenge')
    })
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
