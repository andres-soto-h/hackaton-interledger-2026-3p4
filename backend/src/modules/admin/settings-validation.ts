import { isIP } from 'node:net'
import type { EditableSettings } from '../../shared/settings/editable-settings.js'
import { isValidFeePercentage } from '../fees/fee-percentage.js'

export type SettingsFormResult =
  { ok: true; values: EditableSettings } | { ok: false; errors: Record<string, string> }

const amountEntryPattern = /^([A-Z]{3}):(\d+(?:\.\d+)?)$/
const hostPattern = /^[a-z0-9._-]+$/i

const isIpLiteral = (host: string): boolean => isIP(host.replace(/^\[|\]$/g, '')) !== 0

function validateProviderUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'URL https válida'
  }
  if (url.protocol !== 'https:') return 'URL https válida'
  if (url.username !== '' || url.password !== '') return 'URL sin credenciales'
  if (url.port !== '') return 'URL sin puerto explícito'
  if (url.search !== '') return 'URL sin query'
  const host = url.hostname
  if (host === '' || host === 'localhost' || isIpLiteral(host)) {
    return 'URL sin IP privada, localhost o enlace local'
  }
  return null
}

function validateHost(host: string): boolean {
  if (host === '' || host === 'localhost') return false
  if (isIpLiteral(host)) return false
  return hostPattern.test(host)
}

function parseHosts(value: string): { ok: true; value: string[] } | { ok: false } {
  const hosts = value
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0)
  if (hosts.some((host) => !validateHost(host))) return { ok: false }
  return { ok: true, value: hosts }
}

function parseAmountMap(
  value: string
): { ok: true; value: Record<string, string> } | { ok: false } {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (entries.length === 0) return { ok: false }
  const result: Record<string, string> = {}
  for (const entry of entries) {
    const match = amountEntryPattern.exec(entry)
    const code = match?.[1]
    const amount = match?.[2]
    if (code === undefined || amount === undefined) return { ok: false }
    if (!/[1-9]/.test(amount)) return { ok: false }
    if (result[code] !== undefined) return { ok: false }
    result[code] = amount
  }
  return { ok: true, value: result }
}

function parseTtl(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  if (number < 60 || number > 3600) return null
  return number
}

function validateFrontendResultUrl(value: string): boolean {
  if (value === '') return true
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:'
}

/** Validates the admin settings form and converts it to `EditableSettings`. */
export function parseSettingsForm(
  input: Record<string, string | undefined>
): SettingsFormResult {
  const errors: Record<string, string> = {}
  const values: EditableSettings = {
    walletProviderBaseUrl: '',
    allowedWalletHosts: [],
    maxPaymentAmounts: {},
    dailySpendLimits: {},
    feePercentage: '0',
    linkAuthTtlSeconds: 600,
    frontendResultUrl: '',
    paymentsEnabled: false
  }

  const provider = (input.walletProviderBaseUrl ?? '').trim()
  const providerError = validateProviderUrl(provider)
  if (providerError !== null) errors.walletProviderBaseUrl = providerError
  else values.walletProviderBaseUrl = provider

  const hosts = parseHosts(input.allowedWalletHosts ?? '')
  if (hosts.ok) values.allowedWalletHosts = hosts.value
  else errors.allowedWalletHosts = 'Lista de hosts separados por coma'

  const maxAmounts = parseAmountMap(input.maxPaymentAmounts ?? '')
  if (maxAmounts.ok) values.maxPaymentAmounts = maxAmounts.value
  else errors.maxPaymentAmounts = 'Cada moneda debe ser CODIGO:monto positivo'

  const dailyLimits = parseAmountMap(input.dailySpendLimits ?? '')
  if (dailyLimits.ok) values.dailySpendLimits = dailyLimits.value
  else errors.dailySpendLimits = 'Cada moneda debe ser CODIGO:monto positivo'

  const fee = input.feePercentage ?? ''
  if (isValidFeePercentage(fee)) values.feePercentage = fee
  else errors.feePercentage = 'Porcentaje entre 0 y 10 con hasta 3 decimales'

  const ttl = parseTtl(input.linkAuthTtlSeconds ?? '')
  if (ttl !== null) values.linkAuthTtlSeconds = ttl
  else errors.linkAuthTtlSeconds = 'Entero entre 60 y 3600'

  const frontend = (input.frontendResultUrl ?? '').trim()
  if (validateFrontendResultUrl(frontend)) values.frontendResultUrl = frontend
  else errors.frontendResultUrl = 'URL https o vacío'

  values.paymentsEnabled = input.paymentsEnabled === 'on'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, values }
}
