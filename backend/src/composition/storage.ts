import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { Config } from '../config/env.js'
import { createDynamoPaymentsRepository } from '../modules/payments/dynamo-payments.repository.js'
import { createInMemoryPaymentsRepository } from '../modules/payments/in-memory-payments.repository.js'
import type { PaymentsRepository } from '../modules/payments/payments.repository.js'
import { createDynamoUsersRepository } from '../modules/users/dynamo-users.repository.js'
import { createInMemoryUsersRepository } from '../modules/users/in-memory-users.repository.js'
import type { UsersRepository } from '../modules/users/users.repository.js'
import { createDynamoWalletLinksRepository } from '../modules/wallet-links/dynamo-wallet-links.repository.js'
import { createInMemoryWalletLinksRepository } from '../modules/wallet-links/in-memory-wallet-links.repository.js'
import type { WalletLinksRepository } from '../modules/wallet-links/wallet-links.repository.js'
import { createDynamoActivityLog } from '../shared/activity/dynamo-activity-log.js'
import type { ActivityLog } from '../shared/activity/activity-log.js'
import { createInMemoryActivityLog } from '../shared/activity/in-memory-activity-log.js'
import { createDynamoIdempotencyStore } from '../shared/idempotency/dynamo-store.js'
import { createInMemoryIdempotencyStore } from '../shared/idempotency/in-memory-store.js'
import type { IdempotencyStore } from '../shared/idempotency/store.js'
import type { SettingsStore } from '../shared/settings/editable-settings.js'
import { createDynamoSettingsStore } from '../shared/settings/dynamo-settings-store.js'
import { createInMemorySettingsStore } from '../shared/settings/in-memory-settings-store.js'

/** Every persistence port the API needs, all backed by the same implementation family. */
export interface Storage {
  payments: PaymentsRepository
  users: UsersRepository
  walletLinks: WalletLinksRepository
  settingsStore: SettingsStore
  activityLog: ActivityLog
  idempotencyStore: IdempotencyStore
}

/** Ephemeral storage for local runs and tests. Lost on restart. */
export function createMemoryStorage(): Storage {
  return {
    payments: createInMemoryPaymentsRepository(),
    users: createInMemoryUsersRepository(),
    walletLinks: createInMemoryWalletLinksRepository(),
    settingsStore: createInMemorySettingsStore(),
    activityLog: createInMemoryActivityLog(),
    idempotencyStore: createInMemoryIdempotencyStore()
  }
}

/** The single DynamoDB table of the stack (spec 002) backs every port. */
export function createDynamoStorage(options: {
  client: DynamoDBDocumentClient
  tableName: string
}): Storage {
  return {
    payments: createDynamoPaymentsRepository(options),
    users: createDynamoUsersRepository(options),
    walletLinks: createDynamoWalletLinksRepository(options),
    settingsStore: createDynamoSettingsStore(options),
    activityLog: createDynamoActivityLog(options),
    idempotencyStore: createDynamoIdempotencyStore(options)
  }
}

/** Picks the storage from the configuration: Lambda is always DynamoDB. */
export function createStorage(config: Config): Storage {
  if (config.storage === 'memory' || config.paymentsTableName === undefined) {
    return createMemoryStorage()
  }
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient(
      config.dynamoEndpoint !== undefined ? { endpoint: config.dynamoEndpoint } : {}
    )
  )
  return createDynamoStorage({ client, tableName: config.paymentsTableName })
}
