import { Router, type Request, type RequestHandler } from 'express'
import type { ActivityLevel, ActivityLog } from '../../shared/activity/activity-log.js'
import { AppError, errorBody } from '../../shared/errors/app-error.js'
import type { Payment, PaymentStatus } from '../payments/payment.types.js'
import type { PaymentsRepository } from '../payments/payments.repository.js'
import {
  createAdminSession,
  DEFAULT_SESSION_TTL_SECONDS,
  type AdminSessionManager
} from './admin-session.js'
import { html } from './html.js'
import { renderLayout } from './layout.js'

const CSP =
  "default-src 'self'; style-src 'self' cdn.jsdelivr.net; script-src 'self'; frame-ancestors 'none'"

const LEVELS: ActivityLevel[] = ['info', 'warn', 'error']

const PAYMENT_STATUSES: PaymentStatus[] = [
  'AWAITING_CONFIRMATION',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED'
]

const EVENT_ID_RE = /^evt_[0-9A-Z]{26}$/
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * The feed cursor is opaque to this router: the in-memory log uses the event id
 * (`evt_…`) and the DynamoDB log uses `createdAt|seq|id` in base64. Both are
 * accepted here so an invalid cursor fails fast with `400 VALIDATION_ERROR`.
 */
const isValidAfter = (value: string): boolean => {
  if (EVENT_ID_RE.test(value)) return true
  try {
    const parts = Buffer.from(value, 'base64').toString('utf8').split('|')
    if (parts.length !== 3) return false
    return (
      ISO_PATTERN.test(parts[0] ?? '') &&
      /^\d+$/.test(parts[1] ?? '') &&
      EVENT_ID_RE.test(parts[2] ?? '')
    )
  } catch {
    return false
  }
}

/**
 * External polling script (spec 022). Adds rows with `textContent` (never
 * `innerHTML`), polls every 2000 ms, pauses while the tab is hidden and has a
 * pause/resume button.
 */
const ACTIVITY_JS = `// tranqui activity feed (spec 022)
(function () {
  'use strict'
  var tbody = document.getElementById('activity-rows')
  var pauseButton = document.getElementById('activity-pause')
  var stateLabel = document.getElementById('activity-state')
  var paused = false
  var after = ''

  function query() {
    var params = new URLSearchParams()
    if (after) params.set('after', after)
    var paymentId = document.getElementById('filter-paymentId')
    var type = document.getElementById('filter-type')
    var level = document.getElementById('filter-level')
    if (paymentId && paymentId.value) params.set('paymentId', paymentId.value)
    if (type && type.value) params.set('type', type.value)
    if (level && level.value) params.set('level', level.value)
    return '/admin/activity/feed?' + params.toString()
  }

  function appendRow(event) {
    var tr = document.createElement('tr')
    var cells = ['createdAt', 'level', 'type', 'message', 'paymentId']
    for (var i = 0; i < cells.length; i += 1) {
      var td = document.createElement('td')
      td.textContent = event[cells[i]] || ''
      tr.appendChild(td)
    }
    if (tbody) tbody.insertBefore(tr, tbody.firstChild)
  }

  function tick() {
    if (paused || document.visibilityState === 'hidden') return
    fetch(query(), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) return null
        return res.json()
      })
      .then(function (data) {
        if (!data) return
        var items = data.items || []
        for (var i = 0; i < items.length; i += 1) appendRow(items[i])
        if (data.nextCursor) after = data.nextCursor
        if (stateLabel) stateLabel.textContent = 'Actualizado: ' + new Date().toISOString()
      })
      .catch(function () {})
  }

  if (pauseButton) {
    pauseButton.addEventListener('click', function () {
      paused = !paused
      pauseButton.textContent = paused ? 'Reanudar' : 'Pausar'
    })
  }

  setInterval(tick, 2000)
  tick()
})()
`

export interface AdminActivityDeps {
  enabled?: boolean
  sessionSigningKey: string
  sessionTtlSeconds?: number
  activityLog: ActivityLog
  payments: PaymentsRepository
  now?: () => number
}

const parseCookies = (req: Request): Record<string, string> => {
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

export function createAdminActivityRouter(deps: AdminActivityDeps): Router {
  const router = Router()
  const enabled = deps.enabled ?? true
  const nowMs = deps.now ?? (() => Date.now())
  const ttlSeconds = deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const session: AdminSessionManager = createAdminSession({
    sessionSigningKey: deps.sessionSigningKey,
    sessionTtlSeconds: ttlSeconds,
    now: nowMs
  })

  // Same security posture as the rest of the panel (specs 020 and 021).
  router.use('/admin', (_req, res, next) => {
    res.set('Content-Security-Policy', CSP)
    res.set('X-Frame-Options', 'DENY')
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })

  if (!enabled) {
    const notFound: RequestHandler = (_req, _res, next) => {
      next(new AppError(404, 'NOT_FOUND', 'Route not found'))
    }
    router.use('/admin/activity', notFound)
    router.use('/admin/payments', notFound)
    router.get('/admin/assets/activity.js', notFound)
    return router
  }

  // Assets are public (like the rest of the panel assets).
  router.get('/admin/assets/activity.js', (_req, res) => {
    res.type('js').send(ACTIVITY_JS)
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

  const feedAuth: RequestHandler = (req, res, next) => {
    const token = parseCookies(req)['tranqui_admin'] ?? ''
    if (!session.verify(token)) {
      res.status(401).json(errorBody('UNAUTHORIZED', 'Authentication required'))
      return
    }
    res.locals.adminSession = token
    next()
  }

  const renderActivityPage = (): string => {
    const body = html`
      <h1>Actividad en vivo</h1>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button type="button" id="activity-pause" class="btn btn-outline-secondary">
          Pausar
        </button>
        <span id="activity-state" class="text-muted"></span>
      </div>
      <form method="get" action="/admin/activity" class="row g-2 mb-3">
        <div class="col">
          <input
            type="text"
            class="form-control"
            name="paymentId"
            id="filter-paymentId"
            placeholder="Payment ID"
          />
        </div>
        <div class="col">
          <input
            type="text"
            class="form-control"
            name="type"
            id="filter-type"
            placeholder="Tipo"
          />
        </div>
        <div class="col">
          <select class="form-select" name="level" id="filter-level">
            <option value="">Nivel</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
      </form>
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Nivel</th>
            <th>Tipo</th>
            <th>Mensaje</th>
            <th>Pago</th>
          </tr>
        </thead>
        <tbody id="activity-rows"></tbody>
      </table>
      <script src="/admin/assets/activity.js"></script>
    `
    return renderLayout({ title: 'Actividad', active: 'activity', body })
  }

  const renderPaymentsList = (params: {
    payments: Payment[]
    status?: PaymentStatus
    nextCursor?: string
  }): string => {
    const { payments, status, nextCursor } = params
    const rows = payments.map(
      (payment) => html`
        <tr>
          <td><a href="/admin/payments/${payment.id}">${payment.id}</a></td>
          <td>${payment.status}</td>
          <td>${payment.createdAt}</td>
          <td>${payment.senderWalletAddress}</td>
          <td>${payment.receiverWalletAddress}</td>
        </tr>
      `
    )
    const statusOptions = PAYMENT_STATUSES.map(
      (s) => html`<option value="${s}" ${status === s ? ' selected' : ''}>${s}</option>`
    )
    const query = new URLSearchParams()
    if (status !== undefined) query.set('status', status)
    if (nextCursor !== undefined) query.set('cursor', nextCursor)
    const nextLink =
      nextCursor === undefined
        ? ''
        : html`<a
            class="btn btn-outline-secondary"
            href="/admin/payments?${query.toString()}"
            >Siguiente</a
          >`
    const body = html`
      <h1>Pagos</h1>
      <form method="get" action="/admin/payments" class="row g-2 mb-3">
        <div class="col-auto">
          <select class="form-select" name="status">
            <option value="">Todos</option>
            ${statusOptions}
          </select>
        </div>
        <div class="col-auto">
          <button type="submit" class="btn btn-primary">Filtrar</button>
        </div>
      </form>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Estado</th>
            <th>Creado</th>
            <th>De</th>
            <th>Para</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${nextLink}
    `
    return renderLayout({ title: 'Pagos', active: 'payments', body })
  }

  const renderPaymentDetail = async (payment: Payment): Promise<string> => {
    const timeline = await deps.activityLog.list({ paymentId: payment.id, limit: 100 })
    const rows = timeline.items.map(
      (event) => html`
        <tr>
          <td>${event.createdAt}</td>
          <td>${event.level}</td>
          <td>${event.type}</td>
          <td>${event.message}</td>
        </tr>
      `
    )
    const body = html`
      <h1>${payment.id}</h1>
      <dl class="row">
        <dt class="col-sm-3">Estado</dt>
        <dd class="col-sm-9">${payment.status}</dd>
        <dt class="col-sm-3">Tipo</dt>
        <dd class="col-sm-9">${payment.type}</dd>
        <dt class="col-sm-3">De</dt>
        <dd class="col-sm-9">${payment.senderWalletAddress}</dd>
        <dt class="col-sm-3">Para</dt>
        <dd class="col-sm-9">${payment.receiverWalletAddress}</dd>
        <dt class="col-sm-3">Monto</dt>
        <dd class="col-sm-9">
          ${payment.quote.debitAmount.value} ${payment.quote.debitAmount.assetCode}
        </dd>
        <dt class="col-sm-3">Descripción</dt>
        <dd class="col-sm-9">${payment.description ?? ''}</dd>
        <dt class="col-sm-3">Creado</dt>
        <dd class="col-sm-9">${payment.createdAt}</dd>
      </dl>
      <h2 class="mt-4">Línea de tiempo</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Nivel</th>
            <th>Tipo</th>
            <th>Mensaje</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `
    return renderLayout({ title: payment.id, active: 'payments', body })
  }

  router.get('/admin/activity', adminAuth, (_req, res) => {
    res.type('html').send(renderActivityPage())
  })

  router.get('/admin/activity/feed', feedAuth, async (req, res, next) => {
    try {
      const after = typeof req.query.after === 'string' ? req.query.after : undefined
      const paymentId =
        typeof req.query.paymentId === 'string' ? req.query.paymentId : undefined
      const type = typeof req.query.type === 'string' ? req.query.type : undefined
      const levelParam = typeof req.query.level === 'string' ? req.query.level : undefined

      if (levelParam !== undefined && !LEVELS.includes(levelParam as ActivityLevel)) {
        next(new AppError(400, 'VALIDATION_ERROR', 'Invalid level'))
        return
      }
      if (after !== undefined && !isValidAfter(after)) {
        next(new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor'))
        return
      }

      const result = await deps.activityLog.list({
        after,
        paymentId,
        type,
        level: levelParam as ActivityLevel | undefined,
        limit: 100
      })
      res.status(200).json(result)
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/payments', adminAuth, async (req, res, next) => {
    try {
      const statusParam =
        typeof req.query.status === 'string' ? req.query.status : undefined
      const status = PAYMENT_STATUSES.includes(statusParam as PaymentStatus)
        ? (statusParam as PaymentStatus)
        : undefined
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
      const result = await deps.payments.listAllPayments({ status, limit: 100, cursor })
      res.type('html').send(
        renderPaymentsList({
          payments: result.items,
          status,
          nextCursor: result.nextCursor
        })
      )
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/payments/:id', adminAuth, async (req, res, next) => {
    try {
      const payment = await deps.payments.getPayment(req.params.id as string)
      if (payment === null) {
        next(new AppError(404, 'NOT_FOUND', 'Payment not found'))
        return
      }
      res.type('html').send(await renderPaymentDetail(payment))
    } catch (error) {
      next(error)
    }
  })

  return router
}
