import type { Express } from 'express'
import type { Config } from '../config/env.js'
import type { Secrets } from '../config/secrets.js'
import { createOpenPaymentsGateway } from '../integrations/open-payments/adapter.js'
import { loadPrivateKey } from '../integrations/open-payments/private-key.js'
import type { Logger } from '../shared/logger.js'
import { createSimpleWebAuthnVerifier } from '../shared/webauthn/simplewebauthn-verifier.js'
import { createComposition } from './create-composition.js'
import { createStorage } from './storage.js'

/**
 * Public base URL of the API (used as the Open Payments finish URI): the
 * configured `PUBLIC_API_URL`, or the domain of the request that started the
 * instance. The stack cannot pass its own URL to the Lambda (circular dependency).
 */
export function resolvePublicApiUrl(
  config: Pick<Config, 'publicApiUrl'>,
  fallbackHost: string
): string {
  if (config.publicApiUrl !== undefined) return config.publicApiUrl
  return fallbackHost.startsWith('http') ? fallbackHost : `https://${fallbackHost}`
}

/** Builds the real adapters (Open Payments SDK, WebAuthn, DynamoDB or memory) and the app. */
export async function bootstrap({
  config,
  secrets,
  logger,
  publicApiUrl
}: {
  config: Config
  secrets: Secrets
  logger: Logger
  publicApiUrl: string
}): Promise<Express> {
  const gateway = await createOpenPaymentsGateway({
    walletAddressUrl: secrets.openPayments.walletAddressUrl,
    keyId: secrets.openPayments.keyId,
    privateKey: loadPrivateKey(secrets.openPayments.privateKey),
    timeoutMs: config.openPaymentsTimeoutMs,
    logger
  })

  return createComposition({
    config,
    secrets,
    logger,
    gateway,
    verifier: createSimpleWebAuthnVerifier(),
    storage: createStorage(config),
    publicApiUrl
  })
}
