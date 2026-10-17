import { beforeEach, describe, expect, it } from 'vitest'
import type { Challenge, Credential, User } from '../../src/modules/users/user.types.js'
import {
  UserNotFoundError,
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

    // Spec 021: methods used by the admin panel and by enrollment links.
    describe('admin operations', () => {
      const ALICE = 'usr_01JAAAAAAAAAAAAAAAAAAAAAAA'
      const TOKEN_HASH = 'a'.repeat(64)

      it('creates a user without credentials and keeps wallet uniqueness', async () => {
        await repo.createUser(buildUser())
        expect(await repo.getUser(ALICE)).toEqual(buildUser())
        expect(await repo.listCredentials(ALICE)).toEqual([])
        expect(await repo.findUserByWallet(ALICE_WALLET)).toEqual(buildUser())

        const error = await caught(() =>
          repo.createUser(buildUser({ id: 'usr_01JCCCCCCCCCCCCCCCCCCCCCCC' }))
        )
        expect(error).toBeInstanceOf(WalletAlreadyRegisteredError)
      })

      it('lists every user, newest first', async () => {
        expect(await repo.listUsers()).toEqual([])
        await repo.createUser(buildUser({ createdAt: iso(1) }))
        const { user } = bob()
        await repo.createUser({ ...user, createdAt: iso(5) })
        const listed = await repo.listUsers()
        expect(listed.map((u) => u.displayName)).toEqual(['Bob', 'Alice'])
      })

      it('updates name and wallet, moving the wallet uniqueness', async () => {
        await repo.createUser(buildUser())
        const updated = await repo.updateUser(
          ALICE,
          {
            displayName: 'Alice B',
            walletAddress: 'https://ilp.interledger-test.dev/alice2',
            walletAssetCode: 'MXN'
          },
          iso(9)
        )
        expect(updated).toMatchObject({
          displayName: 'Alice B',
          walletAddress: 'https://ilp.interledger-test.dev/alice2',
          walletAssetCode: 'MXN',
          updatedAt: iso(9)
        })
        expect(await repo.getUser(ALICE)).toEqual(updated)
        expect(await repo.findUserByWallet(ALICE_WALLET)).toBeNull()
        expect((await repo.findUserByWallet(updated.walletAddress))?.id).toBe(ALICE)
        // The old wallet is free again.
        const { user } = bob()
        await repo.createUser({ ...user, walletAddress: ALICE_WALLET })
      })

      it('rejects moving a user to a wallet that belongs to another one', async () => {
        await repo.createUser(buildUser())
        const { user } = bob()
        await repo.createUser(user)
        const error = await caught(() =>
          repo.updateUser(ALICE, { walletAddress: user.walletAddress }, iso(9))
        )
        expect(error).toBeInstanceOf(WalletAlreadyRegisteredError)
        expect((await repo.getUser(ALICE))?.walletAddress).toBe(ALICE_WALLET)
      })

      it('updating only the name leaves the wallet untouched', async () => {
        await repo.createUser(buildUser())
        const updated = await repo.updateUser(ALICE, { displayName: 'Ali' }, iso(2))
        expect(updated.walletAddress).toBe(ALICE_WALLET)
        expect((await repo.findUserByWallet(ALICE_WALLET))?.displayName).toBe('Ali')
      })

      it('updateUser and bumpSessionVersion fail for an unknown user', async () => {
        expect(
          await caught(() => repo.updateUser('usr_missing', { displayName: 'x' }, iso(1)))
        ).toBeInstanceOf(UserNotFoundError)
        expect(
          await caught(() => repo.bumpSessionVersion('usr_missing', iso(1)))
        ).toBeInstanceOf(UserNotFoundError)
      })

      it('bumpSessionVersion increments from 0 and stores the new version', async () => {
        await repo.createUser(buildUser())
        expect(await repo.bumpSessionVersion(ALICE, iso(3))).toBe(1)
        expect(await repo.bumpSessionVersion(ALICE, iso(4))).toBe(2)
        expect(await repo.getUser(ALICE)).toMatchObject({
          sessionVersion: 2,
          updatedAt: iso(4)
        })
      })

      it('two parallel bumps yield two different versions', async () => {
        await repo.createUser(buildUser())
        const versions = await Promise.all([
          repo.bumpSessionVersion(ALICE, iso(3)),
          repo.bumpSessionVersion(ALICE, iso(3))
        ])
        expect([...versions].sort()).toEqual([1, 2])
      })

      it('adds a credential to an existing user', async () => {
        await repo.createUser(buildUser())
        await repo.addCredential(buildCredential())
        expect(await repo.getCredential('cred-alice-1')).toEqual(buildCredential())
        expect(await repo.listCredentials(ALICE)).toHaveLength(1)
      })

      it('deletes one credential, or all of them', async () => {
        await repo.createUserWithCredential(buildUser(), buildCredential())
        await repo.addCredential(buildCredential({ id: 'cred-alice-2' }))
        expect(await repo.deleteCredentials(ALICE, ['cred-alice-1'])).toBe(1)
        expect((await repo.listCredentials(ALICE)).map((c) => c.id)).toEqual([
          'cred-alice-2'
        ])
        expect(await repo.getCredential('cred-alice-1')).toBeNull()
        await repo.addCredential(buildCredential({ id: 'cred-alice-3' }))
        expect(await repo.deleteCredentials(ALICE)).toBe(2)
        expect(await repo.listCredentials(ALICE)).toEqual([])
        expect(await repo.getUser(ALICE)).not.toBeNull()
      })

      it('does not delete credentials that belong to another user', async () => {
        await repo.createUserWithCredential(buildUser(), buildCredential())
        const { user, credential } = bob()
        await repo.createUserWithCredential(user, credential)
        expect(await repo.deleteCredentials(ALICE, ['cred-bob-1'])).toBe(0)
        expect(await repo.getCredential('cred-bob-1')).not.toBeNull()
      })

      describe('enrollment links', () => {
        const enrollment = {
          tokenHash: TOKEN_HASH,
          userId: ALICE,
          expiresAt: 2_000_000_000
        }

        it('reads an enrollment without consuming it', async () => {
          await repo.createEnrollment(enrollment)
          expect(await repo.getEnrollment(TOKEN_HASH, 1_999_999_000)).toEqual(enrollment)
          expect(await repo.getEnrollment(TOKEN_HASH, 1_999_999_000)).toEqual(enrollment)
        })

        it('is consumed exactly once', async () => {
          await repo.createEnrollment(enrollment)
          const results = await Promise.all([
            repo.consumeEnrollment(TOKEN_HASH, 1_999_999_000),
            repo.consumeEnrollment(TOKEN_HASH, 1_999_999_000)
          ])
          expect(results.filter((r) => r !== null)).toEqual([enrollment])
          expect(await repo.getEnrollment(TOKEN_HASH, 1_999_999_000)).toBeNull()
        })

        it('returns null when unknown or expired', async () => {
          expect(await repo.getEnrollment('f'.repeat(64), 1)).toBeNull()
          expect(await repo.consumeEnrollment('f'.repeat(64), 1)).toBeNull()
          await repo.createEnrollment({ ...enrollment, expiresAt: 1_000 })
          expect(await repo.getEnrollment(TOKEN_HASH, 1_001)).toBeNull()
          expect(await repo.consumeEnrollment(TOKEN_HASH, 1_001)).toBeNull()
        })

        it('deleteEnrollments invalidates every link of a user only', async () => {
          await repo.createEnrollment(enrollment)
          await repo.createEnrollment({ ...enrollment, tokenHash: 'b'.repeat(64) })
          await repo.createEnrollment({
            ...enrollment,
            tokenHash: 'c'.repeat(64),
            userId: 'usr_01JBBBBBBBBBBBBBBBBBBBBBBB'
          })
          await repo.deleteEnrollments(ALICE)
          expect(await repo.getEnrollment(TOKEN_HASH, 1)).toBeNull()
          expect(await repo.getEnrollment('b'.repeat(64), 1)).toBeNull()
          expect(await repo.getEnrollment('c'.repeat(64), 1)).not.toBeNull()
        })

        it('deleting the user also removes its enrollment links', async () => {
          await repo.createUser(buildUser())
          await repo.createEnrollment(enrollment)
          await repo.deleteUserAndCredentials(ALICE)
          expect(await repo.getEnrollment(TOKEN_HASH, 1)).toBeNull()
        })
      })
    })
  })
}
