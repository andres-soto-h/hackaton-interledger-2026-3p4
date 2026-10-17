import { Router, type Request, type RequestHandler, type Response } from 'express'
import express from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { ActivityLog } from '../../shared/activity/activity-log.js'
import { AppError } from '../../shared/errors/app-error.js'
import type { Logger } from '../../shared/logger.js'
import {
  SettingsConflictError,
  type EditableSettings,
  type EditableSettingsProvider,
  type SettingsStore
} from '../../shared/settings/editable-settings.js'
import {
  createAdminSession,
  DEFAULT_SESSION_TTL_SECONDS,
  type AdminSessionManager
} from './admin-session.js'
import type { PaymentStatus } from '../payments/payment.types.js'
import type { FeeSummary, FeeSummaryProvider } from '../fees/fee-summary.js'
import {
  type OpenPaymentsStatus,
  type OpenPaymentsStatusChecker,
  type PaymentsSummaryProvider
} from './home-summary.js'
import { escapeHtml, html, raw } from './html.js'
import { renderLayout } from './layout.js'
import { createInMemoryLoginAttempts, type LoginAttemptsStore } from './login-attempts.js'
import { parseSettingsForm } from './settings-validation.js'

const CSP =
  "default-src 'self'; style-src 'self' cdn.jsdelivr.net; script-src 'self'; frame-ancestors 'none'"

const ADMIN_CSS = '/* tranqui admin panel */\n'
const ADMIN_JS = '// tranqui admin panel\n'

const HOME_STATUSES: PaymentStatus[] = [
  'AWAITING_CONFIRMATION',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
]

export interface AdminDeps {
  enabled?: boolean
  adminPassword: string
  sessionSigningKey: string
  sessionTtlSeconds?: number
  settings: EditableSettingsProvider
  settingsStore: SettingsStore
  activityLog: ActivityLog
  paymentsSummary?: PaymentsSummaryProvider
  openPaymentsStatus?: OpenPaymentsStatusChecker
  feeSummary?: FeeSummaryProvider
  loginAttempts?: LoginAttemptsStore
  now?: () => number
  logger?: Logger
}

interface SettingsFields {
  walletProviderBaseUrl: string
  allowedWalletHosts: string
  maxPaymentAmounts: string
  dailySpendLimits: string
  feePercentage: string
  linkAuthTtlSeconds: string
  frontendResultUrl: string
  paymentsEnabled: boolean
}

interface HistoryEntry {
  setting: string
  previous: string
  next: string
}

const FIELD_KEYS: (keyof EditableSettings)[] = [
  'walletProviderBaseUrl',
  'allowedWalletHosts',
  'maxPaymentAmounts',
  'dailySpendLimits',
  'feePercentage',
  'linkAuthTtlSeconds',
  'frontendResultUrl',
  'paymentsEnabled'
]

const STRING_FIELDS: { name: keyof SettingsFields; label: string }[] = [
  { name: 'walletProviderBaseUrl', label: 'URL del proveedor de wallets' },
  { name: 'allowedWalletHosts', label: 'Hosts permitidos (separados por coma)' },
  { name: 'maxPaymentAmounts', label: 'Montos máximos por moneda (CODIGO:monto)' },
  { name: 'dailySpendLimits', label: 'Límites diarios por moneda (CODIGO:monto)' },
  { name: 'feePercentage', label: 'Comisión (%)' },
  { name: 'linkAuthTtlSeconds', label: 'TTL de vinculación (segundos)' },
  { name: 'frontendResultUrl', label: 'URL de resultado' }
]

function textValue(field: keyof EditableSettings, settings: EditableSettings): string {
  switch (field) {
    case 'allowedWalletHosts':
      return settings.allowedWalletHosts.join(', ')
    case 'maxPaymentAmounts':
    case 'dailySpendLimits':
      return Object.entries(settings[field])
        .map(([code, amount]) => `${code}:${amount}`)
        .join(',')
    case 'linkAuthTtlSeconds':
      return String(settings.linkAuthTtlSeconds)
    case 'paymentsEnabled':
      return String(settings.paymentsEnabled)
    default:
      return settings[field]
  }
}

function settingsToFields(settings: EditableSettings): SettingsFields {
  return {
    walletProviderBaseUrl: settings.walletProviderBaseUrl,
    allowedWalletHosts: settings.allowedWalletHosts.join(', '),
    maxPaymentAmounts: textValue('maxPaymentAmounts', settings),
    dailySpendLimits: textValue('dailySpendLimits', settings),
    feePercentage: settings.feePercentage,
    linkAuthTtlSeconds: String(settings.linkAuthTtlSeconds),
    frontendResultUrl: settings.frontendResultUrl,
    paymentsEnabled: settings.paymentsEnabled
  }
}

function rawToFields(input: Record<string, string | undefined>): SettingsFields {
  return {
    walletProviderBaseUrl: input.walletProviderBaseUrl ?? '',
    allowedWalletHosts: input.allowedWalletHosts ?? '',
    maxPaymentAmounts: input.maxPaymentAmounts ?? '',
    dailySpendLimits: input.dailySpendLimits ?? '',
    feePercentage: input.feePercentage ?? '',
    linkAuthTtlSeconds: input.linkAuthTtlSeconds ?? '',
    frontendResultUrl: input.frontendResultUrl ?? '',
    paymentsEnabled: input.paymentsEnabled === 'on'
  }
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (typeof header !== 'string') return {}
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return cookies
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

type AdminFormBody = Record<string, string | undefined>

const formBody = (req: Request): AdminFormBody => (req.body ?? {}) as AdminFormBody

function renderLoginPage(
  flash?: { kind: 'danger'; message: string },
  csrfToken?: string
): string {
  const body = html`
    <h1>Acceso al panel</h1>
    <form method="post" action="/admin/login">
      ${csrfToken !== undefined ? html`<input type="hidden" name="_csrf" value="${csrfToken}" />` : ''}
      <div class="mb-3">
        <label class="form-label" for="password">Clave de administrador</label>
        <input
          type="password"
          class="form-control"
          id="password"
          name="password"
          required
        />
      </div>
      <button type="submit" class="btn btn-primary">Entrar</button>
    </form>
  `
  return renderLayout({ title: 'Acceso al panel', body, showNav: false, flash })
}

function renderSettingsPage(params: {
  version: number
  fields: SettingsFields
  errors?: Record<string, string>
  history: HistoryEntry[]
  csrf: string
  flash?: { kind: 'success' | 'danger'; message: string }
}): string {
  const { version, fields, errors, history, csrf, flash } = params

  const fieldsHtml = STRING_FIELDS.map((field) => {
    const message = errors?.[field.name]
    const extra =
      field.name === 'walletProviderBaseUrl'
        ? raw(
            '<div class="form-text">Al cambiar el proveedor, las wallets registradas con el proveedor anterior dejarán de estar permitidas.</div>'
          )
        : ''
    return html`
      <div class="mb-3">
        <label class="form-label" for="${field.name}">${field.label}</label>
        <input
          type="text"
          class="form-control${message ? ' is-invalid' : ''}"
          id="${field.name}"
          name="${field.name}"
          value="${fields[field.name]}"
        />
        ${message ? raw(`<div class="invalid-feedback d-block" data-field="${field.name}">${escapeHtml(message)}</div>`) : ''}
        ${extra}
      </div>
    `
  })

  const historyRows = history.map(
    (entry) => html`
      <tr>
        <td>${entry.setting}</td>
        <td>${entry.previous}</td>
        <td>${entry.next}</td>
      </tr>
    `
  )

  const body = html`
    <h1>Configuración</h1>
    <form method="post" action="/admin/settings">
      <input type="hidden" name="version" value="${String(version)}" />
      <input type="hidden" name="_csrf" value="${csrf}" />
      ${fieldsHtml}
      <div class="form-check mb-3">
        <input
          type="checkbox"
          class="form-check-input"
          id="paymentsEnabled"
          name="paymentsEnabled"
          ${fields.paymentsEnabled ? ' checked' : ''}
        />
        <label class="form-check-label" for="paymentsEnabled">Pagos habilitados</label>
      </div>
      <button type="submit" class="btn btn-primary">Guardar</button>
    </form>
    <h2 class="mt-4">Historial</h2>
    <table class="table">
      <thead>
        <tr>
          <th>Campo</th>
          <th>Anterior</th>
          <th>Nuevo</th>
        </tr>
      </thead>
      <tbody>
        ${historyRows}
      </tbody>
    </table>
  `

  return renderLayout({
    title: 'Configuración',
    active: 'settings',
    body,
    csrfToken: csrf,
    flash
  })
}

export function createAdminRouter(deps: AdminDeps): Router {
  const router = Router()
  const enabled = deps.enabled ?? true
  const now = deps.now ?? (() => Date.now())
  const ttlSeconds = deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const session: AdminSessionManager = createAdminSession({
    sessionSigningKey: deps.sessionSigningKey,
    sessionTtlSeconds: ttlSeconds,
    now
  })
  const attempts: LoginAttemptsStore = deps.loginAttempts ?? createInMemoryLoginAttempts()
  const passwordHash = createHash('sha256').update(deps.adminPassword).digest()

  const loadHistory = async (): Promise<HistoryEntry[]> => {
    const result = await deps.activityLog.list({ type: 'settings.updated', limit: 100 })
    return result.items
      .slice(-20)
      .reverse()
      .map((event) => ({
        setting: event.data.setting ?? '',
        previous: event.data.previous ?? '',
        next: event.data.next ?? ''
      }))
  }

  // Security headers on every /admin response (pages, redirects, assets, errors).
  router.use('/admin', (_req, res, next) => {
    res.set('Content-Security-Policy', CSP)
    res.set('X-Frame-Options', 'DENY')
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })

  // Parse admin form bodies inside the panel router.
  router.use('/admin', express.urlencoded({ extended: false, limit: '16kb' }))

  if (!enabled) {
    router.use('/admin', (_req, _res, next) => {
      next(new AppError(404, 'NOT_FOUND', 'Route not found'))
    })
    return router
  }

  // Assets are public (the login page needs them).
  router.get('/admin/assets/admin.css', (_req, res) => {
    res.type('css').send(ADMIN_CSS)
  })
  router.get('/admin/assets/admin.js', (_req, res) => {
    res.type('js').send(ADMIN_JS)
  })

  const renderLogin = (
    res: Response,
    status: number,
    flash?: { kind: 'danger'; message: string }
  ): void => {
    const preToken = session.newPreSessionToken()
    res.append(
      'Set-Cookie',
      `tranqui_admin_csrf=${preToken}; HttpOnly; Secure; SameSite=Strict; Path=/admin`
    )
    const body = renderLoginPage(flash, session.csrf(preToken))
    res.status(status).type('html').send(body)
  }

  const deny = (res: Response): void => {
    res.status(403).type('html').send('Prohibido')
  }

  router.get('/admin/login', (_req, res) => {
    renderLogin(res, 200)
  })

  router.post('/admin/login', (req, res) => {
    if (!isSameOrigin(req)) {
      deny(res)
      return
    }
    const body = formBody(req)
    const preToken = parseCookies(req)['tranqui_admin_csrf'] ?? ''
    const receivedCsrf = body._csrf ?? ''
    if (!session.csrfMatches(receivedCsrf, session.csrf(preToken))) {
      deny(res)
      return
    }

    const ip = req.ip ?? ''
    if (attempts.isBlocked(ip, now())) {
      renderLogin(res, 429, { kind: 'danger', message: 'Demasiados intentos' })
      return
    }

    const password = body.password ?? ''
    const received = createHash('sha256').update(password).digest()
    if (!timingSafeEqual(received, passwordHash)) {
      attempts.recordFailure(ip, now())
      renderLogin(res, 401, { kind: 'danger', message: 'Clave inválida' })
      return
    }

    attempts.reset(ip)
    const token = session.issue()
    res.append(
      'Set-Cookie',
      `tranqui_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${ttlSeconds}`
    )
    res.redirect(302, '/admin')
  })

  const adminAuth: RequestHandler = (req, res, next) => {
    const token = parseCookies(req)['tranqui_admin'] ?? ''
    if (!session.verify(token)) {
      res.redirect(302, '/admin/login')
      return
    }
    res.locals.adminSession = token
    next()
  }

  const requireValidPost = (
    req: Request,
    res: Response,
    expectedCsrf: string
  ): boolean => {
    if (!isSameOrigin(req)) {
      deny(res)
      return false
    }
    const received = formBody(req)._csrf ?? ''
    if (!session.csrfMatches(received, expectedCsrf)) {
      deny(res)
      return false
    }
    return true
  }

  router.post('/admin/logout', adminAuth, (req, res) => {
    const token = res.locals.adminSession as string
    if (!requireValidPost(req, res, session.csrf(token))) return
    res.append(
      'Set-Cookie',
      'tranqui_admin=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0'
    )
    res.redirect(302, '/admin/login')
  })

  router.get('/admin', adminAuth, async (_req, res) => {
    const token = res.locals.adminSession as string

    let counts: Partial<Record<PaymentStatus, number>> = {}
    if (deps.paymentsSummary !== undefined) {
      try {
        counts = await deps.paymentsSummary.last24h()
      } catch {
        counts = {}
      }
    }

    let openPayments: OpenPaymentsStatus | null = null
    if (deps.openPaymentsStatus !== undefined) {
      try {
        openPayments = await deps.openPaymentsStatus.check()
      } catch {
        openPayments = null
      }
    }

    let fees: FeeSummary | null = null
    if (deps.feeSummary !== undefined) {
      try {
        fees = await deps.feeSummary.summary()
      } catch {
        fees = null
      }
    }

    const rows = HOME_STATUSES.map(
      (status) => html`
        <tr>
          <td>${status}</td>
          <td>${counts[status] ?? 0}</td>
        </tr>
      `
    )

    const statusBadge =
      openPayments === null
        ? html`<span class="badge text-bg-secondary">No disponible</span>`
        : openPayments.connected
          ? html`<span class="badge text-bg-success">Conectado</span>`
          : html`<span class="badge text-bg-danger">Error: ${openPayments.error}</span>`

    const feesSection =
      fees === null
        ? ''
        : html`
            <h2>Comisiones cobradas</h2>
            <table class="table">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th>Últimas 24 h</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(fees.byCurrency).map(
                  ([currency, totals]) => html`
                    <tr>
                      <td>${currency}</td>
                      <td>${totals.last24h}</td>
                      <td>${totals.total}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
            <table class="table">
              <tbody>
                <tr>
                  <th>Comisiones fallidas</th>
                  <td>${fees.failedCount}</td>
                </tr>
              </tbody>
            </table>
          `

    const body = html`
      <h1>Inicio</h1>
      <h2>Pagos (últimas 24 h)</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Estado</th>
            <th>Conteo</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${feesSection}
      <h2>Open Payments</h2>
      <p>${statusBadge}</p>
      <ul>
        <li><a href="/admin/settings">Configuración</a></li>
      </ul>
    `
    res.type('html').send(
      renderLayout({
        title: 'Inicio',
        active: 'home',
        body,
        csrfToken: session.csrf(token)
      })
    )
  })

  router.get('/admin/settings', adminAuth, async (_req, res) => {
    const token = res.locals.adminSession as string
    const { version, settings } = await deps.settings.getEditable()
    const history = await loadHistory()
    res.type('html').send(
      renderSettingsPage({
        version,
        fields: settingsToFields(settings),
        history,
        csrf: session.csrf(token)
      })
    )
  })

  router.post('/admin/settings', adminAuth, async (req, res) => {
    const token = res.locals.adminSession as string
    if (!requireValidPost(req, res, session.csrf(token))) return

    const body = formBody(req)
    const version = Number(body.version)
    const parsed = parseSettingsForm(body)

    if (!parsed.ok) {
      const history = await loadHistory()
      res
        .status(422)
        .type('html')
        .send(
          renderSettingsPage({
            version: Number.isNaN(version) ? 0 : version,
            fields: rawToFields(body),
            errors: parsed.errors,
            history,
            csrf: session.csrf(token)
          })
        )
      return
    }

    const previous = await deps.settings.getEditable()
    const changedFields = FIELD_KEYS.filter(
      (field) => textValue(field, previous.settings) !== textValue(field, parsed.values)
    )

    if (changedFields.length === 0) {
      res.redirect(302, '/admin/settings')
      return
    }

    try {
      await deps.settingsStore.save(parsed.values, Number.isNaN(version) ? 0 : version)
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        deps.settings.invalidate()
        const fresh = await deps.settings.getEditable()
        const history = await loadHistory()
        res
          .status(409)
          .type('html')
          .send(
            renderSettingsPage({
              version: fresh.version,
              fields: settingsToFields(fresh.settings),
              history,
              csrf: session.csrf(token),
              flash: {
                kind: 'danger',
                message:
                  'La configuración fue modificada por otro administrador. Recarga los valores e inténtalo de nuevo.'
              }
            })
          )
        return
      }
      throw error
    }

    for (const field of changedFields) {
      await deps.activityLog.record({
        type: 'settings.updated',
        message: `Configuración cambiada: ${field}`,
        data: {
          setting: field,
          previous: textValue(field, previous.settings),
          next: textValue(field, parsed.values)
        }
      })
    }

    deps.settings.invalidate()
    res.redirect(302, '/admin/settings')
  })

  return router
}
