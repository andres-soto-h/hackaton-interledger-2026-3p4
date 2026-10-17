import { beforeEach, describe, expect, it } from 'vitest'
import type { Challenge, Credential, User } from '../../src/modules/users/user.types.js'
import {
  WalletAlreadyRegisteredError,
  type UsersRepository
} from '../../src/modules/users/users.repository.js'
import { caught } from '../helpers/errors.js'

const ALICE_WALLET = 'https://ilp.interledger-test.dev/alice'
const BOB_WALLET = 'https://ilp.interledger-test.dev/bob'
const iso = (minute: number): string =>
  new Date(Date.UTC(2026, 9, 17, 10, minute, 0)).toISOString()

export const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA',
  displayName: 'Alice',
  walletAddress: ALICE_WALLET,
  walletAssetCode: 'USD',
  status: 'ACTIVE',
  createdAt: iso(0),
  updatedAt: iso(0),
  ...overrides
})

export const buildCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'cred-alice-1',
  userId: 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA',
  publicKey: 'public-key-alice-1',
  counter: 0,
  transports: ['internal'],
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: iso(0),
  ...overrides
})

export const buildChallenge = (overrides: Partial<Challenge> = {}): Challenge => ({
  id: 'chl_01JAAAAAAAAAAAAAAAAAAAAAAA',
  challenge: 'challenge-value',
  type: 'login',
  expiresAt: 2_000_000_000,
  ...overrides
})

export const bob = () => ({
  user: buildUser({
    id: 'usr_01JBBBBBBBBBBBBBBBBBBBBBBB',
    displayName: 'Bob',
    walletAddress: BOB_WALLET
  }),
  credential: buildCredential({
    id: 'cred-bob-1',
    userId: 'usr_01JBBBBBBBBBBBBBBBBBBBBBBB',
    publicKey: 'public-key-bob-1'
  })
})

// Caso 14: the same behavior for the in-memory and the DynamoDB implementations.
export function runUsersRepositoryContract(
  name: string,
  create: () => UsersRepository | Promise<UsersRepository>
): void {
  describe(`UsersRepository (${name})`, () => {
    let repo: UsersRepository

    beforeEach(async () => {
      repo = await create()
    })

    it('creates a user with its credential and reads them back', async () => {
      await repo.createUserWithCredential(buildUser(), buildCredential())
      expect(await repo.getUser('usr_01JAAAAAAAAAAAAAAAAAAAAAAA')).toEqual(buildUser())
      expect(await repo.getCredential('cred-alice-1')).toEqual(buildCredential())
      expect(await repo.listCredentials('usr_01JAAAAAAAAAAAAAAAAAAAAAAA')).toEqual([
        buildCredential()
      ])
    })

    it('returns null for unknown users, credentials and wallets', async () => {
      expect(await repo.getUser('usr_missing')).toBeNull()
      expect(await repo.getCredential('missing')).toBeNull()
      expect(await repo.findUserByWallet(ALICE_WALLET)).toBeNull()
    })

    it('finds a user by wallet address', async () => {
      await repo.createUserWithCredential(buildUser(), buildCredential())
      expect(await repo.findUserByWallet(ALICE_WALLET)).toEqual(buildUser())
    })

    it('rejects a second account for the same wallet and stores nothing', async () => {
      await repo.createUserWithCredential(buildUser(), buildCredential())
      const intruder = buildUser({ id: 'usr_01JCCCCCCCCCCCCCCCCCCCCCCC' })
      const intruderCredential = buildCredential({
        id: 'cred-intruder',
        userId: intruder.id
      })

      const error = await caught(() =>
        repo.createUserWithCredential(intruder, intruderCredential)
      )
      expect(error).toBeInstanceOf(WalletAlreadyRegisteredError)
      expect(await repo.getUser(intruder.id)).toBeNull()
      expect(await repo.getCredential('cred-intruder')).toBeNull()
    })

    it('only one of two parallel registrations for a wallet succeeds', async () => {
      const second = buildUser({ id: 'usr_01JCCCCCCCCCCCCCCCCCCCCCCC' })
      const results = await Promise.allSettled([
        repo.createUserWithCredential(buildUser(), buildCredential()),
        repo.createUserWithCredential(
          second,
          buildCredential({ id: 'cred-second', userId: second.id })
        )
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    })

    it('updates the counter and last use of a credential', async () => {
      await repo.createUserWithCredential(buildUser(), buildCredential())
      await repo.updateCredentialUsage('cred-alice-1', {
        counter: 7,
        lastUsedAt: iso(30)
      })
      expect(await repo.getCredential('cred-alice-1')).toEqual(
        buildCredential({ counter: 7, lastUsedAt: iso(30) })
      )
    })

    it('changes the status of a user', async () => {
      await repo.createUserWithCredential(buildUser(), buildCredential())
      await repo.setUserStatus('usr_01JAAAAAAAAAAAAAAAAAAAAAAA', 'BLOCKED', iso(10))
      expect(await repo.getUser('usr_01JAAAAAAAAAAAAAAAAAAAAAAA')).toEqual(
        buildUser({ status: 'BLOCKED', updatedAt: iso(10) })
      )
    })

    it('deletes the user, its credentials and the wallet uniqueness, leaving others intact', async () => {
      const other = bob()
      await repo.createUserWithCredential(buildUser(), buildCredential())
      await repo.createUserWithCredential(other.user, other.credential)

      await repo.deleteUserAndCredentials('usr_01JAAAAAAAAAAAAAAAAAAAAAAA')

      expect(await repo.getUser('usr_01JAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
      expect(await repo.getCredential('cred-alice-1')).toBeNull()
      expect(await repo.findUserByWallet(ALICE_WALLET)).toBeNull()
      expect(await repo.getUser(other.user.id)).toEqual(other.user)
      expect(await repo.getCredential('cred-bob-1')).toEqual(other.credential)

      // The wallet can be registered again by a new account.
      const again = buildUser({ id: 'usr_01JDDDDDDDDDDDDDDDDDDDDDDD' })
      await repo.createUserWithCredential(
        again,
        buildCredential({ id: 'cred-again', userId: again.id })
      )
      expect(await repo.findUserByWallet(ALICE_WALLET)).toEqual(again)
    })

    it('deleting an unknown user is not an error', async () => {
      await repo.deleteUserAndCredentials('usr_missing')
    })

    describe('challenges', () => {
      it('is consumed exactly once', async () => {
        await repo.createChallenge(buildChallenge())
        const first = await repo.consumeChallenge(
          'chl_01JAAAAAAAAAAAAAAAAAAAAAAA',
          1_999_999_000
        )
        expect(first).toEqual(buildChallenge())
        expect(
          await repo.consumeChallenge('chl_01JAAAAAAAAAAAAAAAAAAAAAAA', 1_999_999_000)
        ).toBeNull()
      })

      it('keeps the pending registration data', async () => {
        const challenge = buildChallenge({
          type: 'register',
          pending: {
            userId: 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA',
            displayName: 'Alice',
            walletAddress: ALICE_WALLET,
            walletAssetCode: 'USD'
          }
        })
        await repo.createChallenge(challenge)
        expect(await repo.consumeChallenge(challenge.id, 1_999_999_000)).toEqual(
          challenge
        )
      })

      it('returns null when it does not exist or has expired', async () => {
        expect(await repo.consumeChallenge('chl_missing', 1)).toBeNull()
        await repo.createChallenge(buildChallenge({ expiresAt: 1_000 }))
        expect(
          await repo.consumeChallenge('chl_01JAAAAAAAAAAAAAAAAAAAAAAA', 1_001)
        ).toBeNull()
      })

      it('only one of two parallel consumptions succeeds', async () => {
        await repo.createChallenge(buildChallenge())
        const results = await Promise.all([
          repo.consumeChallenge('chl_01JAAAAAAAAAAAAAAAAAAAAAAA', 1_999_999_000),
          repo.consumeChallenge('chl_01JAAAAAAAAAAAAAAAAAAAAAAA', 1_999_999_000)
        ])
        expect(results.filter((r) => r !== null)).toHaveLength(1)
      })
    })
  })
}
