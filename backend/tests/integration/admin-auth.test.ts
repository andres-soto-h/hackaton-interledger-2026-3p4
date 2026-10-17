import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_PASSWORD,
  attemptLogin,
  buildAdminHarness,
  call,
  csrfOf,
  loginAsAdmin,
  mergeCookies,
  ORIGIN,
  SIGNING_KEY
} from '../helpers/admin.js'
import { buildTestApp } from '../helpers/app.js'
import { signJwtWithKey } from '../helpers/jwt.js'

const nowSeconds = (h: ReturnType<typeof buildAdminHarness>) =>
  Math.floor(h.clock.ms / 1000)

// Caso 1
describe('/admin sin sesión', () => {
  it.each(['/admin', '/admin/settings'])('GET %s redirige al login', async (path) => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', path)
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
  })

  it('un POST sin sesión también redirige al login y no cambia nada', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'post', '/admin/settings')
      .type('form')
      .send({ feePercentage: '5' })
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
    expect(await h.settingsStore.get()).toBeNull()
  })

  it('el login es público: no usa la API key del resto de la API', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin/login')
    expect(res.status).toBe(200)
    expect(res.text).toContain('name="password"')
    expect(res.text).toContain('name="_csrf"')
  })

  it('el resto de la API sigue exigiendo la API key', async () => {
    const h = buildAdminHarness()
    const res = await request(h.app).get('/api/v1/anything')
    expect(res.status).toBe(401)
  })
})

// Caso 2
describe('login', () => {
  it('con la clave correcta responde 302 a /admin y fija la cookie de sesión con sus atributos', async () => {
    const h = buildAdminHarness()
    const login = await attemptLogin(h, ADMIN_PASSWORD)
    expect(login.status).toBe(302)
    const cookie = login.setCookie.find((c) => c.startsWith('tranqui_admin='))
    expect(cookie).toBeDefined()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/admin')
    expect(cookie).toContain('Max-Age=28800')

    const home = await call(h.app, 'get', '/admin').set('cookie', login.cookie)
    expect(home.status).toBe(200)
    expect(home.text).toContain('href="/admin/settings"')
  })

  it('el JWT de la cookie lleva aud tranqui-admin y vence a las 8 h', async () => {
    const h = buildAdminHarness()
    const login = await attemptLogin(h, ADMIN_PASSWORD)
    const token =
      login.setCookie
        .find((c) => c.startsWith('tranqui_admin='))
        ?.split(';')[0]
        ?.split('=')[1] ?? ''
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()
    ) as {
      aud: string
      exp: number
    }
    expect(claims.aud).toBe('tranqui-admin')
    expect(claims.exp).toBe(nowSeconds(h) + 8 * 3600)
  })

  it('con una clave incorrecta responde 401 con un mensaje genérico y sin cookie de sesión', async () => {
    const h = buildAdminHarness()
    const login = await attemptLogin(h, 'wrong-password')
    expect(login.status).toBe(401)
    expect(login.text).toContain('Clave inválida')
    expect(login.text).not.toContain('wrong-password')
    expect(login.setCookie.some((c) => c.startsWith('tranqui_admin='))).toBe(false)
  })

  it('la cookie vence: pasadas las 8 h vuelve al login', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    h.clock.ms += 8 * 3600 * 1000 + 1000
    const res = await call(h.app, 'get', '/admin').set('cookie', session.cookie)
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
  })

  it('el login sin token CSRF se rechaza con 403', async () => {
    const h = buildAdminHarness()
    const login = await attemptLogin(h, ADMIN_PASSWORD, { withCsrf: false })
    expect(login.status).toBe(403)
  })
})

// Caso 3
describe('bloqueo por intentos fallidos', () => {
  it('el sexto intento se bloquea aunque la clave sea correcta, sin revelar si lo era', async () => {
    const h = buildAdminHarness()
    for (let i = 0; i < 5; i++) {
      expect((await attemptLogin(h, `wrong-${i}`)).status).toBe(401)
    }
    const blocked = await attemptLogin(h, ADMIN_PASSWORD)
    expect(blocked.status).toBe(429)
    expect(blocked.text).toContain('Demasiados intentos')
    expect(blocked.text).not.toContain('Clave inválida')
    expect(blocked.setCookie.some((c) => c.startsWith('tranqui_admin='))).toBe(false)
  })

  it('un intento incorrecto cuando ya está bloqueado da la misma respuesta', async () => {
    const h = buildAdminHarness()
    for (let i = 0; i < 5; i++) await attemptLogin(h, `wrong-${i}`)
    const wrong = await attemptLogin(h, 'still-wrong')
    const right = await attemptLogin(h, ADMIN_PASSWORD)
    expect(wrong.status).toBe(429)
    expect(right.status).toBe(429)
  })

  it('pasados 15 minutos se puede intentar de nuevo', async () => {
    const h = buildAdminHarness()
    for (let i = 0; i < 5; i++) await attemptLogin(h, `wrong-${i}`)
    h.clock.ms += 15 * 60 * 1000 + 1000
    expect((await attemptLogin(h, ADMIN_PASSWORD)).status).toBe(302)
  })

  it('4 fallos seguidos de un acierto no bloquean', async () => {
    const h = buildAdminHarness()
    for (let i = 0; i < 4; i++) await attemptLogin(h, `wrong-${i}`)
    expect((await attemptLogin(h, ADMIN_PASSWORD)).status).toBe(302)
  })
})

// Caso 4
describe('cookie con otra audiencia', () => {
  const forged = (
    h: ReturnType<typeof buildAdminHarness>,
    claims: Record<string, unknown>
  ) => `tranqui_admin=${signJwt(SIGNING_KEY, { exp: nowSeconds(h) + 600, ...claims })}`

  it('un JWT de usuario de la app (aud distinto) firmado con la misma clave se rechaza', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin').set(
      'cookie',
      forged(h, { aud: 'tranqui-user', sub: 'usr_1' })
    )
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
  })

  it('un JWT admin firmado con otra clave se rechaza', async () => {
    const h = buildAdminHarness()
    const token = signJwt('another-key-another-key-another-key', {
      aud: 'tranqui-admin',
      exp: nowSeconds(h) + 600
    })
    const res = await call(h.app, 'get', '/admin').set('cookie', `tranqui_admin=${token}`)
    expect(res.status).toBe(302)
  })

  it('un JWT admin vencido se rechaza', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin').set(
      'cookie',
      forged(h, { aud: 'tranqui-admin', exp: nowSeconds(h) - 10 })
    )
    expect(res.status).toBe(302)
  })

  it('un JWT admin válido forjado con la clave de sesión sí entra', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin').set(
      'cookie',
      forged(h, { aud: 'tranqui-admin' })
    )
    expect(res.status).toBe(200)
  })

  it('una cookie con basura se rechaza sin error 500', async () => {
    const h = buildAdminHarness()
    const res = await call(h.app, 'get', '/admin').set(
      'cookie',
      'tranqui_admin=not.a.jwt'
    )
    expect(res.status).toBe(302)
  })
})

// Caso 5
describe('CSRF y Origin', () => {
  it('logout sin token CSRF → 403 y la sesión sigue activa', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    const res = await call(h.app, 'post', '/admin/logout')
      .type('form')
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({})
    expect(res.status).toBe(403)
    expect(
      (await call(h.app, 'get', '/admin').set('cookie', session.cookie)).status
    ).toBe(200)
  })

  it('logout con token CSRF de otra sesión → 403', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    h.clock.ms += 1000
    const other = await loginAsAdmin(h)
    expect(other.csrf).not.toBe(session.csrf)
    const res = await call(h.app, 'post', '/admin/logout')
      .type('form')
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ _csrf: other.csrf })
    expect(res.status).toBe(403)
  })

  it('un Origin ajeno → 403 aunque el token sea válido', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    const res = await call(h.app, 'post', '/admin/logout')
      .type('form')
      .set('cookie', session.cookie)
      .set('origin', 'https://evil.example')
      .send({ _csrf: session.csrf })
    expect(res.status).toBe(403)
  })

  it('el login con Origin ajeno → 403', async () => {
    const h = buildAdminHarness()
    const login = await attemptLogin(h, ADMIN_PASSWORD, {
      origin: 'https://evil.example'
    })
    expect(login.status).toBe(403)
  })

  it('logout válido: 302 al login y borra la cookie', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    const res = await call(h.app, 'post', '/admin/logout')
      .type('form')
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ _csrf: session.csrf })
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/admin/login')
    const setCookie = (res.headers['set-cookie'] as string[] | undefined) ?? []
    const cleared = setCookie.find((c) => c.startsWith('tranqui_admin='))
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })

  it('las acciones que modifican nunca responden a GET', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    const res = await call(h.app, 'get', '/admin/logout').set('cookie', session.cookie)
    expect([404, 405]).toContain(res.status)
  })

  it('el token CSRF de la página cambia con la sesión y es distinto del JWT', async () => {
    const h = buildAdminHarness()
    const session = await loginAsAdmin(h)
    expect(session.csrf.length).toBeGreaterThanOrEqual(32)
    expect(session.cookie).not.toContain(session.csrf)
    const page = await call(h.app, 'get', '/admin').set('cookie', session.cookie)
    expect(csrfOf(page.text)).toBe(session.csrf)
    expect(mergeCookies(session.cookie)).toContain('tranqui_admin=')
  })
})

// Caso 12
describe('ADMIN_ENABLED=false', () => {
  it.each(['/admin', '/admin/login', '/admin/settings', '/admin/assets/admin.css'])(
    'GET %s responde 404',
    async (path) => {
      const h = buildAdminHarness({ enabled: false })
      const res = await call(h.app, 'get', path)
      expect(res.status).toBe(404)
    }
  )

  it('POST /admin/login también responde 404', async () => {
    const h = buildAdminHarness({ enabled: false })
    const res = await call(h.app, 'post', '/admin/login')
      .type('form')
      .send({ password: ADMIN_PASSWORD })
    expect(res.status).toBe(404)
  })

  it('el resto de la app sigue funcionando', async () => {
    const app = buildAdminHarness({ enabled: false }).app
    expect((await request(app).get('/health')).status).toBe(200)
  })
})

describe('integración con la app', () => {
  it('sin el router de admin montado, /admin responde 404 (la API key no se aplica a /admin)', async () => {
    const res = await request(buildTestApp()).get('/admin/login')
    expect(res.status).toBe(404)
  })
})
