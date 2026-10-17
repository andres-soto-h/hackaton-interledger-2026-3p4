import { escapeHtml, type SafeHtml } from './html.js'

const BOOTSTRAP_CSS_URL =
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'
const BOOTSTRAP_CSS_SRI =
  'sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH'

export interface RenderLayoutOptions {
  title: string
  body: SafeHtml
  active?: 'home' | 'settings' | 'users' | 'activity' | 'payments'
  flash?: { kind: 'success' | 'danger'; message: string }
  csrfToken?: string
  showNav?: boolean
}

/** Shared HTML5 document for the admin panel: Bootstrap 5 CSS only, no inline scripts. */
export function renderLayout({
  title,
  body,
  active,
  flash,
  csrfToken,
  showNav = true
}: RenderLayoutOptions): string {
  const flashHtml =
    flash === undefined
      ? ''
      : `<div class="alert alert-${
          flash.kind === 'success' ? 'success' : 'danger'
        }" role="alert">${escapeHtml(flash.message)}</div>`

  const csrfField =
    csrfToken === undefined
      ? ''
      : `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`

  const nav = showNav
    ? `<nav class="navbar navbar-expand navbar-light bg-light mb-4">
      <div class="container">
        <span class="navbar-brand">tranqui</span>
        <ul class="navbar-nav me-auto">
          <li class="nav-item"><a class="nav-link${active === 'home' ? ' active' : ''}" href="/admin">Inicio</a></li>
          <li class="nav-item"><a class="nav-link${active === 'activity' ? ' active' : ''}" href="/admin/activity">Actividad</a></li>
          <li class="nav-item"><a class="nav-link${active === 'users' ? ' active' : ''}" href="/admin/users">Usuarios</a></li>
          <li class="nav-item"><a class="nav-link${active === 'settings' ? ' active' : ''}" href="/admin/settings">Configuración</a></li>
        </ul>
        <form class="d-flex" action="/admin/logout" method="post">${csrfField}<button type="submit" class="btn btn-outline-secondary btn-sm">Cerrar sesión</button></form>
      </div>
    </nav>`
    : ''

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${BOOTSTRAP_CSS_URL}" integrity="${BOOTSTRAP_CSS_SRI}" crossorigin="anonymous">
<link rel="stylesheet" href="/admin/assets/admin.css">
<script src="/admin/assets/admin.js"></script>
</head>
<body>
${nav}
<main class="container">
${flashHtml}
${body.toString()}
</main>
</body>
</html>`
}
