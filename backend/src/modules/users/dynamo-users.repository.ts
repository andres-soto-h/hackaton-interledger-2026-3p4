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
  User,
  UserStatus
} from './user.types.js'
import { WalletAlreadyRegisteredError, type UsersRepository } from './users.repository.js'

type Item = Record<string, unknown>

const CREDENTIAL_PREFIX = 'cred#'
const WALLET_PREFIX = 'wallet#'

const credentialKey = (credentialId: string): string =>
  `${CREDENTIAL_PREFIX}${credentialId}`
const walletKey = (walletAddress: string): string => `${WALLET_PREFIX}${walletAddress}`

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

const userFromItem = (item: Item): User => ({
  id: item['id'] as string,
  displayName: item['displayName'] as string,
  walletAddress: item['walletAddress'] as string,
  walletAssetCode: item['walletAssetCode'] as string,
  status: item['status'] as UserStatus,
  createdAt: item['createdAt'] as string,
  updatedAt: item['updatedAt'] as string
})

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
    }
  }
}
