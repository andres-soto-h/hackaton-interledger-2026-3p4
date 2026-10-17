import {
  ConditionalCheckFailedException,
  TransactionCanceledException
} from '@aws-sdk/client-dynamodb'
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb'
import type {
  Challenge,
  Credential,
  CredentialDeviceType,
  Enrollment,
  User,
  UserStatus
} from './user.types.js'
import {
  UserNotFoundError,
  WalletAlreadyRegisteredError,
  type UsersRepository
} from './users.repository.js'

type Item = Record<string, unknown>

const CREDENTIAL_PREFIX = 'cred#'
const WALLET_PREFIX = 'wallet#'
const ENROLLMENT_PREFIX = 'enr#'

const credentialKey = (credentialId: string): string =>
  `${CREDENTIAL_PREFIX}${credentialId}`
const walletKey = (walletAddress: string): string => `${WALLET_PREFIX}${walletAddress}`
const enrollmentKey = (tokenHash: string): string => `${ENROLLMENT_PREFIX}${tokenHash}`

const userToItem = (user: User): Item => ({
  id: user.id,
  entityType: 'user',
  displayName: user.displayName,
  walletAddress: user.walletAddress,
  walletAssetCode: user.walletAssetCode,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
})

const userFromItem = (item: Item): User => {
  const user: User = {
    id: item['id'] as string,
    displayName: item['displayName'] as string,
    walletAddress: item['walletAddress'] as string,
    walletAssetCode: item['walletAssetCode'] as string,
    status: item['status'] as UserStatus,
    createdAt: item['createdAt'] as string,
    updatedAt: item['updatedAt'] as string
  }
  if (item['sessionVersion'] !== undefined) {
    user.sessionVersion = item['sessionVersion'] as number
  }
  return user
}

const credentialToItem = (credential: Credential): Item => {
  const item: Item = {
    id: credentialKey(credential.id),
    credentialId: credential.id,
    entityType: 'credential',
    userId: credential.userId,
    publicKey: credential.publicKey,
    counter: credential.counter,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    createdAt: credential.createdAt
  }
  if (credential.transports !== undefined) item['transports'] = credential.transports
  if (credential.lastUsedAt !== undefined) item['lastUsedAt'] = credential.lastUsedAt
  return item
}

const credentialFromItem = (item: Item): Credential => {
  const credential: Credential = {
    id: item['credentialId'] as string,
    userId: item['userId'] as string,
    publicKey: item['publicKey'] as string,
    counter: item['counter'] as number,
    deviceType: item['deviceType'] as CredentialDeviceType,
    backedUp: item['backedUp'] as boolean,
    createdAt: item['createdAt'] as string
  }
  if (item['transports'] !== undefined) {
    credential.transports = item['transports'] as string[]
  }
  if (item['lastUsedAt'] !== undefined) {
    credential.lastUsedAt = item['lastUsedAt'] as string
  }
  return credential
}

const challengeToItem = (challenge: Challenge): Item => {
  const item: Item = {
    id: challenge.id,
    challenge: challenge.challenge,
    type: challenge.type,
    expiresAt: challenge.expiresAt
  }
  if (challenge.pending !== undefined) item['pending'] = challenge.pending
  return item
}

const enrollmentToItem = (enrollment: Enrollment): Item => ({
  id: enrollmentKey(enrollment.tokenHash),
  entityType: 'enrollment',
  tokenHash: enrollment.tokenHash,
  userId: enrollment.userId,
  expiresAt: enrollment.expiresAt,
  // Required by the `byUser` index (its range key is `createdAt`).
  createdAt: new Date(enrollment.expiresAt * 1000 - 86_400_000).toISOString()
})

const enrollmentFromItem = (item: Item): Enrollment => ({
  tokenHash: item['tokenHash'] as string,
  userId: item['userId'] as string,
  expiresAt: item['expiresAt'] as number
})

/**
 * DynamoDB implementation of `UsersRepository` for Lambda. One table, keyed by
 * `id`; users, credentials and wallet-uniqueness records share it. Credentials
 * are listed with the `byUser` index and the table keeps a numeric `expiresAt`
 * TTL for challenges.
 */
export function createDynamoUsersRepository({
  client,
  tableName
}: {
  client: DynamoDBDocumentClient
  tableName: string
}): UsersRepository {
  async function getUser(id: string): Promise<User | null> {
    const result = await client.send(
      new GetCommand({ TableName: tableName, Key: { id } })
    )
    return result.Item === undefined ? null : userFromItem(result.Item)
  }

  async function getCredential(credentialId: string): Promise<Credential | null> {
    const result = await client.send(
      new GetCommand({ TableName: tableName, Key: { id: credentialKey(credentialId) } })
    )
    return result.Item === undefined ? null : credentialFromItem(result.Item)
  }

  async function listCredentials(userId: string): Promise<Credential[]> {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'byUser',
        KeyConditionExpression: '#userId = :userId',
        FilterExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#userId': 'userId', '#entityType': 'entityType' },
        ExpressionAttributeValues: { ':userId': userId, ':entityType': 'credential' }
      })
    )
    return (result.Items ?? []).map(credentialFromItem)
  }

  async function listEnrollments(userId: string): Promise<Enrollment[]> {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'byUser',
        KeyConditionExpression: '#userId = :userId',
        FilterExpression: '#entityType = :entityType',
        ExpressionAttributeNames: { '#userId': 'userId', '#entityType': 'entityType' },
        ExpressionAttributeValues: { ':userId': userId, ':entityType': 'enrollment' }
      })
    )
    return (result.Items ?? []).map(enrollmentFromItem)
  }

  return {
    async createUserWithCredential(user, credential) {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: { TableName: tableName, Item: userToItem(user) } },
              { Put: { TableName: tableName, Item: credentialToItem(credential) } },
              {
                Put: {
                  TableName: tableName,
                  Item: { id: walletKey(user.walletAddress), userId: user.id },
                  ConditionExpression: 'attribute_not_exists(#id)',
                  ExpressionAttributeNames: { '#id': 'id' }
                }
              }
            ]
          })
        )
      } catch (error) {
        if (
          error instanceof TransactionCanceledException &&
          (error.CancellationReasons ?? []).some(
            (reason) => reason?.Code === 'ConditionalCheckFailed'
          )
        ) {
          throw new WalletAlreadyRegisteredError()
        }
        throw error
      }
    },

    getUser,

    async findUserByWallet(walletAddress) {
      const result = await client.send(
        new GetCommand({ TableName: tableName, Key: { id: walletKey(walletAddress) } })
      )
      if (result.Item === undefined) return null
      return getUser(result.Item['userId'] as string)
    },

    getCredential,

    listCredentials,

    async updateCredentialUsage(credentialId, change) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id: credentialKey(credentialId) },
          UpdateExpression: 'SET #counter = :counter, #lastUsedAt = :lastUsedAt',
          ExpressionAttributeNames: {
            '#counter': 'counter',
            '#lastUsedAt': 'lastUsedAt'
          },
          ExpressionAttributeValues: {
            ':counter': change.counter,
            ':lastUsedAt': change.lastUsedAt
          }
        })
      )
    },

    async setUserStatus(userId, status, updatedAt) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { id: userId },
          UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
          ExpressionAttributeValues: { ':status': status, ':updatedAt': updatedAt }
        })
      )
    },

    async deleteUserAndCredentials(userId) {
      const user = await getUser(userId)
      if (user === null) return
      const credentials = await listCredentials(userId)
      const enrollments = await listEnrollments(userId)

      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: tableName, Key: { id: user.id } } },
            {
              Delete: { TableName: tableName, Key: { id: walletKey(user.walletAddress) } }
            },
            ...credentials.map((credential) => ({
              Delete: {
                TableName: tableName,
                Key: { id: credentialKey(credential.id) }
              }
            })),
            ...enrollments.map((enrollment) => ({
              Delete: {
                TableName: tableName,
                Key: { id: enrollmentKey(enrollment.tokenHash) }
              }
            }))
          ]
        })
      )
    },

    async createChallenge(challenge) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: challengeToItem(challenge)
        })
      )
    },

    async consumeChallenge(id, nowSeconds) {
      try {
        const result = await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id },
            ConditionExpression: 'attribute_exists(#id) AND #expiresAt > :now',
            ExpressionAttributeNames: { '#id': 'id', '#expiresAt': 'expiresAt' },
            ExpressionAttributeValues: { ':now': nowSeconds },
            ReturnValues: 'ALL_OLD'
          })
        )
        return result.Attributes === undefined
          ? null
          : (result.Attributes as unknown as Challenge)
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return null
        throw error
      }
    },

    async createUser(user) {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: { TableName: tableName, Item: userToItem(user) } },
              {
                Put: {
                  TableName: tableName,
                  Item: { id: walletKey(user.walletAddress), userId: user.id },
                  ConditionExpression: 'attribute_not_exists(#id)',
                  ExpressionAttributeNames: { '#id': 'id' }
                }
              }
            ]
          })
        )
      } catch (error) {
        if (
          error instanceof TransactionCanceledException &&
          (error.CancellationReasons ?? []).some(
            (reason) => reason?.Code === 'ConditionalCheckFailed'
          )
        ) {
          throw new WalletAlreadyRegisteredError()
        }
        throw error
      }
    },

    async listUsers() {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'byType',
          KeyConditionExpression: '#entityType = :entityType',
          ExpressionAttributeNames: { '#entityType': 'entityType' },
          ExpressionAttributeValues: { ':entityType': 'user' },
          ScanIndexForward: false
        })
      )
      return (result.Items ?? []).map(userFromItem)
    },

    async updateUser(userId, changes, updatedAt) {
      const current = await getUser(userId)
      if (current === null) throw new UserNotFoundError()

      const nextWallet = changes.walletAddress ?? current.walletAddress
      const setParts: string[] = ['#updatedAt = :updatedAt']
      const names: Record<string, string> = { '#updatedAt': 'updatedAt' }
      const values: Record<string, unknown> = { ':updatedAt': updatedAt }
      if (changes.displayName !== undefined) {
        setParts.push('#displayName = :displayName')
        names['#displayName'] = 'displayName'
        values[':displayName'] = changes.displayName
      }
      if (changes.walletAssetCode !== undefined) {
        setParts.push('#walletAssetCode = :walletAssetCode')
        names['#walletAssetCode'] = 'walletAssetCode'
        values[':walletAssetCode'] = changes.walletAssetCode
      }

      if (nextWallet === current.walletAddress) {
        setParts.push('#walletAddress = :walletAddress')
        names['#walletAddress'] = 'walletAddress'
        values[':walletAddress'] = current.walletAddress
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: userId },
            UpdateExpression: `SET ${setParts.join(', ')}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values
          })
        )
      } else {
        setParts.push('#walletAddress = :walletAddress')
        names['#walletAddress'] = 'walletAddress'
        values[':walletAddress'] = nextWallet
        try {
          await client.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Update: {
                    TableName: tableName,
                    Key: { id: userId },
                    UpdateExpression: `SET ${setParts.join(', ')}`,
                    ExpressionAttributeNames: { ...names, '#id': 'id' },
                    ExpressionAttributeValues: values,
                    ConditionExpression: 'attribute_exists(#id)'
                  }
                },
                {
                  Delete: {
                    TableName: tableName,
                    Key: { id: walletKey(current.walletAddress) }
                  }
                },
                {
                  Put: {
                    TableName: tableName,
                    Item: { id: walletKey(nextWallet), userId },
                    ConditionExpression: 'attribute_not_exists(#id)',
                    ExpressionAttributeNames: { '#id': 'id' }
                  }
                }
              ]
            })
          )
        } catch (error) {
          if (
            error instanceof TransactionCanceledException &&
            (error.CancellationReasons ?? []).some(
              (reason) => reason?.Code === 'ConditionalCheckFailed'
            )
          ) {
            throw new WalletAlreadyRegisteredError()
          }
          throw error
        }
      }

      const updated = await getUser(userId)
      if (updated === null) throw new UserNotFoundError()
      return updated
    },

    async bumpSessionVersion(userId, updatedAt) {
      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { id: userId },
            UpdateExpression:
              'SET #sessionVersion = if_not_exists(#sessionVersion, :zero) + :one, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#sessionVersion': 'sessionVersion',
              '#updatedAt': 'updatedAt',
              '#id': 'id'
            },
            ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':updatedAt': updatedAt },
            ConditionExpression: 'attribute_exists(#id)',
            ReturnValues: 'ALL_NEW'
          })
        )
        const version = result.Attributes?.['sessionVersion'] as number | undefined
        if (version === undefined) throw new UserNotFoundError()
        return version
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException)
          throw new UserNotFoundError()
        throw error
      }
    },

    async addCredential(credential) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: credentialToItem(credential)
        })
      )
    },

    async deleteCredentials(userId, credentialIds) {
      const own = await listCredentials(userId)
      const toDelete =
        credentialIds === undefined
          ? own
          : own.filter((credential) => credentialIds.includes(credential.id))
      for (const credential of toDelete) {
        await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id: credentialKey(credential.id) },
            ConditionExpression: '#userId = :userId',
            ExpressionAttributeNames: { '#userId': 'userId' },
            ExpressionAttributeValues: { ':userId': userId }
          })
        )
      }
      return toDelete.length
    },

    async createEnrollment(enrollment) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: enrollmentToItem(enrollment)
        })
      )
    },

    async getEnrollment(tokenHash, nowSeconds) {
      const result = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { id: enrollmentKey(tokenHash) }
        })
      )
      if (result.Item === undefined) return null
      const enrollment = enrollmentFromItem(result.Item)
      if (enrollment.expiresAt <= nowSeconds) return null
      return enrollment
    },

    async consumeEnrollment(tokenHash, nowSeconds) {
      try {
        const result = await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id: enrollmentKey(tokenHash) },
            ConditionExpression: 'attribute_exists(#id) AND #expiresAt > :now',
            ExpressionAttributeNames: { '#id': 'id', '#expiresAt': 'expiresAt' },
            ExpressionAttributeValues: { ':now': nowSeconds },
            ReturnValues: 'ALL_OLD'
          })
        )
        return result.Attributes === undefined
          ? null
          : enrollmentFromItem(result.Attributes)
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return null
        throw error
      }
    },

    async deleteEnrollments(userId) {
      const enrollments = await listEnrollments(userId)
      for (const enrollment of enrollments) {
        await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { id: enrollmentKey(enrollment.tokenHash) }
          })
        )
      }
    }
  }
}
