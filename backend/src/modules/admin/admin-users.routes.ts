import { createHash, randomBytes } from 'node:crypto'
import { Router, type Request, type RequestHandler } from 'express'
import express from 'express'
import type { WalletAddress } from '../../integrations/open-payments/gateway.js'
import type { OpenPaymentsGateway } from '../../integrations/open-payments/gateway.js'
import type { ActivityLog } from '../../shared/activity/activity-log.js'
import { AppError } from '../../shared/errors/app-error.js'
import { newUserId } from '../../shared/ids/ids.js'
import { assertSafeWalletUrl } from '../../shared/security/wallet-url.js'
import type { SettingsProvider } from '../../shared/settings/settings-provider.js'
import type { User, UserStatus } from '../users/user.types.js'
import type { UsersRepository } from '../users/users.repository.js'
import {
  createAdminSession,
  DEFAULT_SESSION_TTL_SECONDS,
  type AdminSessionManager
} from './admin-session.js'
import type { AdminPaymentsReader, AdminWalletLinks } from './admin-users.types.js'
import { escapeHtml, html } from './html.js'
import { renderLayout } from './layout.js'

const CSP =
  "default-src 'self'; style-src 'self' cdn.jsdelivr.net; script-src 'self'; frame-ancestors 'none'"

const ENROLLMENT_TTL_SECONDS = 86_400

export interface AdminUsersDeps {
  enabled?: boolean
  sessionSigningKey: string
  sessionTtlSeconds?: number
  users: UsersRepository
  activityLog: ActivityLog
  gateway: OpenPaymentsGateway
  settings: SettingsProvider
  enrollmentUrl: string
  walletLinks?: AdminWalletLinks
  payments?: AdminPaymentsReader
  now?: () => number
}

type FormBody = Record<string, string | undefined>

const formBody = (req: Request): FormBody => (req.body ?? {}) as FormBody

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

const walletErrorMessage = (error: unknown): string => {
  if (error instanceof AppError) {
    if (error.code === 'WALLET_NOT_FOUND') return 'No se encontró la wallet'
    if (error.code === 'WALLET_NOT_ALLOWED') return 'La wallet no está permitida'
  }
  return 'No se encontró la wallet'
}

const encodeCursor = (createdAt: string): string =>
  Buffer.from(createdAt, 'utf8').toString('base64url')

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const decodeCursor = (cursor: string): string | null => {
  try {
    const value = Buffer.from(cursor, 'base64url').toString('utf8')
    if (!ISO_PATTERN.test(value)) return null
    return value
  } catch {
    return null
  }
}

const truncate = (value: string): string =>
  value.length <= 8 ? value : `${value.slice(0, 8)}…`

export function createAdminUsersRouter(deps: AdminUsersDeps): Router {
  const router = Router()
  const enabled = deps.enabled ?? true
  const nowMs = deps.now ?? (() => Date.now())
  const nowSeconds = (): number => Math.floor(nowMs() / 1000)
  const iso = (): string => new Date(nowMs()).toISOString()
  const ttlSeconds = deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const session: AdminSessionManager = createAdminSession({
    sessionSigningKey: deps.sessionSigningKey,
    sessionTtlSeconds: ttlSeconds,
    now: nowMs
  })

  // Same security posture as the rest of the panel (spec 020).
  router.use('/admin', (_req, res, next) => {
    res.set('Content-Security-Policy', CSP)
    res.set('X-Frame-Options', 'DENY')
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })
  router.use('/admin/users', express.urlencoded({ extended: false, limit: '16kb' }))

  if (!enabled) {
    router.use('/admin/users', (_req, _res, next) => {
      next(new AppError(404, 'NOT_FOUND', 'Route not found'))
    })
    return router
  }

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
    res: Parameters<RequestHandler>[1],
    expectedCsrf: string
  ): boolean => {
    if (!isSameOrigin(req)) {
      res.status(403).type('html').send('Prohibido')
      return false
    }
    const received = formBody(req)._csrf ?? ''
    if (!session.csrfMatches(received, expectedCsrf)) {
      res.status(403).type('html').send('Prohibido')
      return false
    }
    return true
  }

  const notFound = (res: Parameters<RequestHandler>[1]): void => {
    res.status(404).type('html').send('No encontrado')
  }

  const record = (type: string, message: string, userId: string): Promise<unknown> =>
    deps.activityLog.record({ type, message, data: { userId } })

  const resolveWallet = async (
    rawWallet: string
  ): Promise<{ ok: true; wallet: WalletAddress } | { ok: false; error: string }> => {
    let safeUrl: string
    try {
      safeUrl = assertSafeWalletUrl(rawWallet, await deps.settings.getSettings())
    } catch (error) {
      return { ok: false, error: walletErrorMessage(error) }
    }
    try {
      const wallet = await deps.gateway.getWalletAddress(safeUrl)
      return { ok: true, wallet }
    } catch (error) {
      return { ok: false, error: walletErrorMessage(error) }
    }
  }

  const renderUserList = (params: {
    q: string
    users: User[]
    nextCursor?: string
    csrf: string
  }): string => {
    const { q, users, nextCursor, csrf } = params
    const rows = users.map(
      (user) => html`
        <tr>
          <td>${user.displayName}</td>
          <td>${user.walletAddress}</td>
          <td>${user.status}</td>
          <td><a href="/admin/users/${user.id}">Ver</a></td>
        </tr>
      `
    )
    const nextLink =
      nextCursor === undefined
        ? ''
        : `<a class="btn btn-outline-secondary" href="/admin/users?q=${encodeURIComponent(
            q
          )}&amp;cursor=${encodeURIComponent(nextCursor)}">Siguiente</a>`

    const body = html`
      <h1>Usuarios</h1>
      <form method="get" action="/admin/users" class="mb-3">
        <div class="input-group">
          <input type="text" class="form-control" name="q" value="${q}" />
          <button type="submit" class="btn btn-primary">Buscar</button>
        </div>
      </form>
      <table class="table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Wallet</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${nextLink}
      <a class="btn btn-primary" href="/admin/users/new">Nuevo usuario</a>
    `
    return renderLayout({ title: 'Usuarios', active: 'users', body, csrfToken: csrf })
  }

  const renderUserForm = (params: {
    title: string
    action: string
    submitLabel: string
    displayName: string
    walletAddress: string
    errors: Record<string, string>
    csrf: string
  }): string => {
    const { title, action, submitLabel, displayName, walletAddress, errors, csrf } =
      params
    const nameError = errors.displayName
    const walletError = errors.walletAddress
    const body = html`
      <h1>${title}</h1>
      <form method="post" action="${action}">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="mb-3">
          <label class="form-label" for="displayName">Nombre</label>
          <input
            type="text"
            class="form-control${nameError !== undefined ? ' is-invalid' : ''}"
            id="displayName"
            name="displayName"
            value="${displayName}"
          />
          ${
            nameError !== undefined
              ? `<div class="invalid-feedback d-block">${escapeHtml(nameError)}</div>`
              : ''
          }
        </div>
        <div class="mb-3">
          <label class="form-label" for="walletAddress">Wallet</label>
          <input
            type="text"
            class="form-control${walletError !== undefined ? ' is-invalid' : ''}"
            id="walletAddress"
            name="walletAddress"
            value="${walletAddress}"
          />
          ${
            walletError !== undefined
              ? `<div class="invalid-feedback d-block">${escapeHtml(walletError)}</div>`
              : ''
          }
        </div>
        <button type="submit" class="btn btn-primary">${submitLabel}</button>
      </form>
    `
    return renderLayout({ title, active: 'users', body, csrfToken: csrf })
  }

  const renderEditForm = (params: {
    user: User
    displayName: string
    walletAddress: string
    status: string
    errors: Record<string, string>
    csrf: string
  }): string => {
    const { user, displayName, walletAddress, status, errors, csrf } = params
    const statusError = errors.status
    const body = html`
      <h1>Editar usuario</h1>
      <form method="post" action="/admin/users/${user.id}">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="mb-3">
          <label class="form-label" for="displayName">Nombre</label>
          <input
            type="text"
            class="form-control${errors.displayName !== undefined ? ' is-invalid' : ''}"
            id="displayName"
            name="displayName"
            value="${displayName}"
          />
          ${
            errors.displayName !== undefined
              ? `<div class="invalid-feedback d-block">${escapeHtml(errors.displayName)}</div>`
              : ''
          }
        </div>
        <div class="mb-3">
          <label class="form-label" for="walletAddress">Wallet</label>
          <input
            type="text"
            class="form-control${errors.walletAddress !== undefined ? ' is-invalid' : ''}"
            id="walletAddress"
            name="walletAddress"
            value="${walletAddress}"
          />
          ${
            errors.walletAddress !== undefined
              ? `<div class="invalid-feedback d-block">${escapeHtml(errors.walletAddress)}</div>`
              : ''
          }
        </div>
        <div class="mb-3">
          <label class="form-label" for="status">Estado</label>
          <select
            class="form-select${statusError !== undefined ? ' is-invalid' : ''}"
            id="status"
            name="status"
          >
            <option value="ACTIVE" ${status === 'ACTIVE' ? ' selected' : ''}>
              ACTIVE
            </option>
            <option value="BLOCKED" ${status === 'BLOCKED' ? ' selected' : ''}>
              BLOCKED
            </option>
          </select>
          ${
            statusError !== undefined
              ? `<div class="invalid-feedback d-block">${escapeHtml(statusError)}</div>`
              : ''
          }
        </div>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </form>
    `
    return renderLayout({
      title: 'Editar usuario',
      active: 'users',
      body,
      csrfToken: csrf
    })
  }

  const renderEnrollmentPage = (params: {
    enrollmentUrl: string
    token: string
    csrf: string
  }): string => {
    const { enrollmentUrl, token, csrf } = params
    const link = `${enrollmentUrl}?token=${token}`
    const body = html`
      <h1>Enlace de registro</h1>
      <p>Comparte este enlace de un solo uso; caduca en 24 horas.</p>
      <div class="mb-3">
        <input
          type="text"
          class="form-control"
          id="enrollment-link"
          readonly
          value="${link}"
        />
      </div>
      <a class="btn btn-primary" href="/admin/users">Volver a usuarios</a>
    `
    return renderLayout({
      title: 'Enlace de registro',
      active: 'users',
      body,
      csrfToken: csrf
    })
  }

  const renderDetail = async (params: { user: User; csrf: string }): Promise<string> => {
    const { user, csrf } = params
    const credentials = await deps.users.listCredentials(user.id)

    const credentialRows = credentials.map((credential) => {
      const backedUp = credential.backedUp ? 'Sí' : 'No'
      const lastUsed = credential.lastUsedAt ?? '—'
      return html`
        <tr>
          <td>${truncate(credential.id)}</td>
          <td>${credential.createdAt}</td>
          <td>${lastUsed}</td>
          <td>Sincronizado: ${backedUp}</td>
          <td>
            <form method="post" action="/admin/users/${user.id}/reset-access" class="m-0">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="credentialId" value="${credential.id}" />
              <button type="submit" class="btn btn-sm btn-outline-secondary">
                Revocar
              </button>
            </form>
          </td>
        </tr>
      `
    })

    let walletSection = 'Sin vincular'
    let revokeWalletForm = ''
    if (deps.walletLinks !== undefined) {
      const summary = await deps.walletLinks.getSummary(user.id)
      if (summary !== null) {
        const lines = [`Estado: ${summary.status}`]
        if (summary.dailyLimit !== undefined)
          lines.push(`Límite diario: ${summary.dailyLimit}`)
        if (summary.spentToday !== undefined)
          lines.push(`Gastado hoy: ${summary.spentToday}`)
        if (summary.assetCode !== undefined) lines.push(`Moneda: ${summary.assetCode}`)
        walletSection = lines.join(' · ')
        revokeWalletForm = html`
          <form
            method="post"
            action="/admin/users/${user.id}/revoke-wallet-link"
            class="d-inline"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            <button type="submit" class="btn btn-sm btn-outline-danger">
              Revocar vinculación
            </button>
          </form>
        `.toString()
      }
    }

    let paymentsSection = ''
    if (deps.payments !== undefined) {
      const payments = await deps.payments.listRecent(user.walletAddress, 10)
      if (payments.length > 0) {
        const rows = payments.map(
          (payment) => html`
            <tr>
              <td>${payment.id}</td>
              <td>${payment.status}</td>
              <td>${payment.amount ?? ''}</td>
              <td>${payment.assetCode ?? ''}</td>
              <td>${payment.createdAt}</td>
            </tr>
          `
        )
        paymentsSection = html`
          <h2 class="mt-4">Últimos pagos</h2>
          <table class="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Estado</th>
                <th>Monto</th>
                <th>Moneda</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        `.toString()
      }
    }

    const blockStatus: UserStatus = user.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED'
    const blockLabel = user.status === 'BLOCKED' ? 'Desbloquear' : 'Bloquear'

    const body = html`
      <h1>${user.displayName}</h1>
      <dl class="row">
        <dt class="col-sm-3">Wallet</dt>
        <dd class="col-sm-9">${user.walletAddress}</dd>
        <dt class="col-sm-3">Moneda</dt>
        <dd class="col-sm-9">${user.walletAssetCode}</dd>
        <dt class="col-sm-3">Estado</dt>
        <dd class="col-sm-9">${user.status}</dd>
        <dt class="col-sm-3">Creado</dt>
        <dd class="col-sm-9">${user.createdAt}</dd>
      </dl>

      <h2>Passkeys</h2>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Fecha de creación</th>
            <th>Último uso</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${credentialRows}
        </tbody>
      </table>

      <h2>Vinculación de wallet</h2>
      <p>${walletSection}</p>
      ${revokeWalletForm} ${paymentsSection}

      <h2 class="mt-4">Acciones</h2>
      <div class="d-flex gap-2 flex-wrap">
        <a class="btn btn-outline-primary" href="/admin/users/${user.id}/edit">Editar</a>
        <form method="post" action="/admin/users/${user.id}" class="d-inline">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="displayName" value="${user.displayName}" />
          <input type="hidden" name="walletAddress" value="${user.walletAddress}" />
          <input type="hidden" name="status" value="${blockStatus}" />
          <button type="submit" class="btn btn-outline-warning">${blockLabel}</button>
        </form>
        <form
          method="post"
          action="/admin/users/${user.id}/reset-access"
          class="d-inline"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="credentialId" value="all" />
          <button type="submit" class="btn btn-outline-danger">Restablecer acceso</button>
        </form>
        <form method="post" action="/admin/users/${user.id}/delete" class="d-inline">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="confirm" value="yes" />
          <button type="submit" class="btn btn-outline-danger">Borrar</button>
        </form>
      </div>
    `
    return renderLayout({
      title: user.displayName,
      active: 'users',
      body,
      csrfToken: csrf
    })
  }

  // ── Routes ────────────────────────────────────────────────────────────────

  router.use('/admin/users', adminAuth)

  router.get('/admin/users', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      const q = (typeof req.query.q === 'string' ? req.query.q : '').trim()
      const cursorParam =
        typeof req.query.cursor === 'string' ? req.query.cursor : undefined

      let cursor: string | undefined
      if (cursorParam !== undefined) {
        const decoded = decodeCursor(cursorParam)
        if (decoded === null) {
          res.status(400).type('html').send('Cursor inválido')
          return
        }
        cursor = decoded
      }

      let users = await deps.users.listUsers()
      const needle = q.toLowerCase()
      if (needle !== '') {
        users = users.filter(
          (user) =>
            user.displayName.toLowerCase().includes(needle) ||
            user.walletAddress.toLowerCase().includes(needle)
        )
      }
      if (cursor !== undefined) {
        users = users.filter((user) => user.createdAt < cursor)
      }

      const page = users.slice(0, 20)
      const nextCursor = users.length > 20 ? encodeCursor(page[19]!.createdAt) : undefined

      res
        .status(200)
        .type('html')
        .send(
          renderUserList({
            q,
            users: page,
            nextCursor,
            csrf: session.csrf(token)
          })
        )
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/users/new', (_req, res) => {
    const token = res.locals.adminSession as string
    res
      .status(200)
      .type('html')
      .send(
        renderUserForm({
          title: 'Nuevo usuario',
          action: '/admin/users',
          submitLabel: 'Crear',
          displayName: '',
          walletAddress: '',
          errors: {},
          csrf: session.csrf(token)
        })
      )
  })

  router.post('/admin/users', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      if (!requireValidPost(req, res, session.csrf(token))) return

      const body = formBody(req)
      const displayName = (body.displayName ?? '').trim()
      const walletAddress = (body.walletAddress ?? '').trim()
      const errors: Record<string, string> = {}

      if (displayName.length < 1 || displayName.length > 60) {
        errors.displayName = 'El nombre debe tener entre 1 y 60 caracteres'
      }

      let wallet: WalletAddress | null = null
      if (walletAddress === '') {
        errors.walletAddress = 'La wallet es obligatoria'
      } else {
        const resolved = await resolveWallet(walletAddress)
        if (!resolved.ok) {
          errors.walletAddress = resolved.error
        } else {
          const existing = await deps.users.findUserByWallet(resolved.wallet.id)
          if (existing !== null) {
            errors.walletAddress = 'La wallet ya está registrada'
          } else {
            wallet = resolved.wallet
          }
        }
      }

      if (Object.keys(errors).length > 0) {
        res
          .status(422)
          .type('html')
          .send(
            renderUserForm({
              title: 'Nuevo usuario',
              action: '/admin/users',
              submitLabel: 'Crear',
              displayName,
              walletAddress,
              errors,
              csrf: session.csrf(token)
            })
          )
        return
      }

      const userId = newUserId(nowMs())
      const user: User = {
        id: userId,
        displayName,
        walletAddress: wallet!.id,
        walletAssetCode: wallet!.assetCode,
        status: 'ACTIVE',
        createdAt: iso(),
        updatedAt: iso()
      }
      await deps.users.createUser(user)

      const enrollmentToken = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(enrollmentToken).digest('hex')
      await deps.users.createEnrollment({
        tokenHash,
        userId,
        expiresAt: nowSeconds() + ENROLLMENT_TTL_SECONDS
      })

      await record('user.created', 'Usuario creado', userId)

      res
        .status(201)
        .type('html')
        .send(
          renderEnrollmentPage({
            enrollmentUrl: deps.enrollmentUrl,
            token: enrollmentToken,
            csrf: session.csrf(token)
          })
        )
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/users/:id', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      const user = await deps.users.getUser(req.params.id)
      if (user === null) {
        notFound(res)
        return
      }
      res
        .status(200)
        .type('html')
        .send(await renderDetail({ user, csrf: session.csrf(token) }))
    } catch (error) {
      next(error)
    }
  })

  router.get('/admin/users/:id/edit', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      const user = await deps.users.getUser(req.params.id)
      if (user === null) {
        notFound(res)
        return
      }
      res
        .status(200)
        .type('html')
        .send(
          renderEditForm({
            user,
            displayName: user.displayName,
            walletAddress: user.walletAddress,
            status: user.status,
            errors: {},
            csrf: session.csrf(token)
          })
        )
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/users/:id', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      if (!requireValidPost(req, res, session.csrf(token))) return

      const userId = req.params.id
      const user = await deps.users.getUser(userId)
      if (user === null) {
        notFound(res)
        return
      }

      const body = formBody(req)
      const displayName = (body.displayName ?? '').trim()
      const walletAddress = (body.walletAddress ?? '').trim()
      const status = body.status ?? ''

      if (status !== 'ACTIVE' && status !== 'BLOCKED') {
        res
          .status(422)
          .type('html')
          .send(
            renderEditForm({
              user,
              displayName,
              walletAddress,
              status,
              errors: { status: 'Estado inválido' },
              csrf: session.csrf(token)
            })
          )
        return
      }

      const errors: Record<string, string> = {}
      if (displayName.length < 1 || displayName.length > 60) {
        errors.displayName = 'El nombre debe tener entre 1 y 60 caracteres'
      }

      let newWalletAddress = user.walletAddress
      let newAssetCode = user.walletAssetCode
      if (walletAddress !== user.walletAddress) {
        const resolved = await resolveWallet(walletAddress)
        if (!resolved.ok) {
          errors.walletAddress = resolved.error
        } else {
          const existing = await deps.users.findUserByWallet(resolved.wallet.id)
          if (existing !== null && existing.id !== userId) {
            errors.walletAddress = 'La wallet ya está registrada'
          } else {
            newWalletAddress = resolved.wallet.id
            newAssetCode = resolved.wallet.assetCode
          }
        }
      }

      if (Object.keys(errors).length > 0) {
        res
          .status(422)
          .type('html')
          .send(
            renderEditForm({
              user,
              displayName,
              walletAddress,
              status,
              errors,
              csrf: session.csrf(token)
            })
          )
        return
      }

      const isBlocking = status === 'BLOCKED' && user.status !== 'BLOCKED'
      const isUnblocking = status === 'ACTIVE' && user.status === 'BLOCKED'
      const nameChanged = displayName !== user.displayName
      const walletChanged = newWalletAddress !== user.walletAddress

      if (isBlocking) {
        await deps.users.setUserStatus(userId, 'BLOCKED', iso())
        await deps.users.bumpSessionVersion(userId, iso())
        await record('user.blocked', 'Usuario bloqueado', userId)
      } else {
        const changed = isUnblocking || nameChanged || walletChanged
        if (changed) {
          if (isUnblocking) await deps.users.setUserStatus(userId, 'ACTIVE', iso())
          if (nameChanged || walletChanged) {
            await deps.users.updateUser(
              userId,
              {
                ...(nameChanged ? { displayName } : {}),
                ...(walletChanged
                  ? { walletAddress: newWalletAddress, walletAssetCode: newAssetCode }
                  : {})
              },
              iso()
            )
          }
          await record('user.updated', 'Usuario actualizado', userId)
        }
      }

      res.redirect(302, `/admin/users/${userId}`)
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/users/:id/delete', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      if (!requireValidPost(req, res, session.csrf(token))) return

      const userId = req.params.id
      const user = await deps.users.getUser(userId)
      if (user === null) {
        notFound(res)
        return
      }
      if (formBody(req).confirm !== 'yes') {
        res.status(422).type('html').send('Falta la confirmación')
        return
      }

      if (deps.walletLinks !== undefined) await deps.walletLinks.revoke(userId)
      await deps.users.deleteUserAndCredentials(userId)
      await record('user.deleted', 'Usuario borrado', userId)

      res.redirect(302, '/admin/users')
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/users/:id/reset-access', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      if (!requireValidPost(req, res, session.csrf(token))) return

      const userId = req.params.id
      const user = await deps.users.getUser(userId)
      if (user === null) {
        notFound(res)
        return
      }

      const credentialId = formBody(req).credentialId ?? ''
      if (credentialId === '') {
        res.status(422).type('html').send('Falta el credentialId')
        return
      }
      if (credentialId !== 'all') {
        const credential = await deps.users.getCredential(credentialId)
        if (credential === null || credential.userId !== userId) {
          res.status(422).type('html').send('Passkey no válido')
          return
        }
      }

      if (credentialId === 'all') {
        await deps.users.deleteCredentials(userId)
      } else {
        await deps.users.deleteCredentials(userId, [credentialId])
      }
      await deps.users.bumpSessionVersion(userId, iso())
      await deps.users.deleteEnrollments(userId)

      const enrollmentToken = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(enrollmentToken).digest('hex')
      await deps.users.createEnrollment({
        tokenHash,
        userId,
        expiresAt: nowSeconds() + ENROLLMENT_TTL_SECONDS
      })

      await record('user.access_reset', 'Acceso restablecido', userId)

      res
        .status(200)
        .type('html')
        .send(
          renderEnrollmentPage({
            enrollmentUrl: deps.enrollmentUrl,
            token: enrollmentToken,
            csrf: session.csrf(token)
          })
        )
    } catch (error) {
      next(error)
    }
  })

  router.post('/admin/users/:id/revoke-wallet-link', async (req, res, next) => {
    try {
      const token = res.locals.adminSession as string
      if (!requireValidPost(req, res, session.csrf(token))) return

      const userId = req.params.id
      const user = await deps.users.getUser(userId)
      if (user === null) {
        notFound(res)
        return
      }

      if (deps.walletLinks !== undefined) await deps.walletLinks.revoke(userId)

      res.redirect(302, `/admin/users/${userId}`)
    } catch (error) {
      next(error)
    }
  })

  return router
}
