import { isIP } from 'node:net'
import { AppError } from '../errors/app-error.js'
import type { Settings } from '../settings/settings-provider.js'

const handlePattern = /^[a-z0-9._-]+$/i

const notAllowed = (): AppError =>
  new AppError(422, 'WALLET_NOT_ALLOWED', 'Wallet address is not allowed')

const isIpLiteral = (host: string): boolean => isIP(host.replace(/^\[|\]$/g, '')) !== 0

/**
 * Validates and normalizes a wallet address against the configured wallet
 * provider and allowed hosts (anti-SSRF). Accepts a payment pointer
 * (`$host/path`), a full `https` URL, or a short handle resolved against the
 * provider. Rejects non-https schemes, credentials, non-default ports,
 * `localhost`, literal IPs and hosts outside the allow list. No DNS resolution.
 */
export function assertSafeWalletUrl(
  input: string,
  settings: Pick<Settings, 'walletProviderBaseUrl' | 'allowedWalletHosts'>
): string {
  let candidate: string
  if (input.startsWith('$')) {
    candidate = `https://${input.slice(1)}`
  } else if (input.includes('://')) {
    candidate = input
  } else if (handlePattern.test(input) && !input.includes('..')) {
    candidate = `${settings.walletProviderBaseUrl}/${input}`
  } else {
    throw notAllowed()
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw notAllowed()
  }

  if (url.protocol !== 'https:') throw notAllowed()
  if (url.username !== '' || url.password !== '') throw notAllowed()
  if (url.port !== '' && url.port !== '443') throw notAllowed()

  const host = url.hostname
  if (host === 'localhost' || host === '' || isIpLiteral(host)) throw notAllowed()

  const providerHost = new URL(settings.walletProviderBaseUrl).hostname
  const allowed = new Set<string>([providerHost, ...settings.allowedWalletHosts])
  if (!allowed.has(host)) throw notAllowed()

  url.port = ''
  return url.toString()
}
