import { Router } from 'express'

/**
 * Minimal local page to exercise passkeys end to end (spec 019, case 16) while
 * the frontend does not exist yet. It is mounted only in `server.ts` (local).
 */

const HTML = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prueba de passkeys · Tranqui</title>
    <link rel="stylesheet" href="/dev/passkeys.css" />
  </head>
  <body>
    <main class="card">
      <h1>Prueba de passkeys</h1>
      <p class="hint">
        Registra una cuenta o inicia sesión con tu passkey. Los datos quedan en
        esta pestaña del navegador; la API nunca guarda tu PIN.
      </p>

      <section>
        <h2>Registrarse</h2>
        <label for="displayName">Nombre visible</label>
        <input id="displayName" type="text" value="Alice" autocomplete="off" />
        <label for="walletAddress">Wallet address</label>
        <input
          id="walletAddress"
          type="text"
          value="https://ilp.interledger-test.dev/alice"
          autocomplete="off"
        />
        <button id="register">Registrarse con passkey</button>
      </section>

      <section>
        <h2>Iniciar sesión</h2>
        <button id="login">Iniciar sesión con passkey</button>
      </section>

      <section>
        <h2>Sesión</h2>
        <button id="me">Ver mi cuenta</button>
        <button id="delete">Borrar mi cuenta</button>
      </section>

      <pre id="output" aria-live="polite"></pre>
    </main>
    <script src="/dev/passkeys.js"></script>
  </body>
</html>
`

const CSS = `:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  padding: 2rem;
  background: #f4f5f7;
  color: #1c1e21;
}
.card {
  max-width: 36rem;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #e2e4e8;
  border-radius: 12px;
  padding: 1.5rem 2rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}
h1 {
  margin-top: 0;
  font-size: 1.6rem;
}
h2 {
  font-size: 1.05rem;
  margin-bottom: 0.5rem;
}
.hint {
  color: #5b6570;
  font-size: 0.9rem;
}
section {
  margin: 1.25rem 0;
  padding-top: 1rem;
  border-top: 1px solid #eceef1;
}
label {
  display: block;
  font-size: 0.85rem;
  margin: 0.5rem 0 0.25rem;
  color: #5b6570;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.6rem;
  border: 1px solid #ccd0d5;
  border-radius: 8px;
  font-size: 0.95rem;
}
button {
  margin: 0.75rem 0.5rem 0.25rem 0;
  padding: 0.5rem 0.9rem;
  border: 0;
  border-radius: 8px;
  background: #1456f0;
  color: #ffffff;
  font-size: 0.95rem;
  cursor: pointer;
}
button:hover {
  background: #0f47c9;
}
#output {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #111418;
  color: #d7dde5;
  border-radius: 8px;
  min-height: 3rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8rem;
}
`

const JS = `(function () {
  'use strict'

  // Base64url <-> ArrayBuffer conversions done by hand (no external helpers).

  function base64urlToArrayBuffer(value) {
    var base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    var padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    var binary = atob(padded)
    var bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  function arrayBufferToBase64url(buffer) {
    var bytes = new Uint8Array(buffer)
    var binary = ''
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  }

  function credentialToJson(credential) {
    var response = {
      clientDataJSON: arrayBufferToBase64url(credential.response.clientDataJSON)
    }
    if (credential.response.attestationObject) {
      response.attestationObject = arrayBufferToBase64url(credential.response.attestationObject)
    }
    if (credential.response.authenticatorData) {
      response.authenticatorData = arrayBufferToBase64url(credential.response.authenticatorData)
    }
    if (credential.response.signature) {
      response.signature = arrayBufferToBase64url(credential.response.signature)
    }
    if (typeof credential.response.getTransports === 'function') {
      response.transports = credential.response.getTransports()
    }
    return {
      id: credential.id,
      rawId: arrayBufferToBase64url(credential.rawId),
      type: credential.type,
      response: response,
      clientExtensionResults: credential.getClientExtensionResults()
    }
  }

  var output = document.getElementById('output')
  var token = window.sessionStorage.getItem('tranqui-session-token') || null

  function log(text) {
    output.textContent = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
  }

  async function api(path, options) {
    var headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = 'Bearer ' + token
    var response = await fetch(path, Object.assign({ headers: headers }, options))
    if (response.status === 204) return null
    var body = await response.json().catch(function () { return null })
    if (!response.ok) {
      throw new Error((body && body.error && body.error.code) || ('HTTP ' + response.status))
    }
    return body
  }

  function saveSession(session) {
    token = session.token
    window.sessionStorage.setItem('tranqui-session-token', session.token)
  }

  async function register() {
    log('Solicitando opciones de registro…')
    var displayName = document.getElementById('displayName').value.trim()
    var walletAddress = document.getElementById('walletAddress').value.trim()
    var optionsRes = await api('/api/v1/auth/register/options', {
      method: 'POST',
      body: JSON.stringify({ displayName: displayName, walletAddress: walletAddress })
    })
    var publicKey = Object.assign({}, optionsRes.options, {
      challenge: base64urlToArrayBuffer(optionsRes.options.challenge),
      user: Object.assign({}, optionsRes.options.user, {
        id: base64urlToArrayBuffer(optionsRes.options.user.id)
      })
    })
    var credential = await navigator.credentials.create({ publicKey: publicKey })
    log('Verificando registro…')
    var verified = await api('/api/v1/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: optionsRes.challengeId, credential: credentialToJson(credential) })
    })
    saveSession(verified.session)
    log(verified)
  }

  async function login() {
    log('Solicitando opciones de inicio de sesión…')
    var optionsRes = await api('/api/v1/auth/login/options', { method: 'POST' })
    var publicKey = Object.assign({}, optionsRes.options, {
      challenge: base64urlToArrayBuffer(optionsRes.options.challenge)
    })
    var credential = await navigator.credentials.get({ publicKey: publicKey })
    log('Verificando inicio de sesión…')
    var verified = await api('/api/v1/auth/login/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId: optionsRes.challengeId, credential: credentialToJson(credential) })
    })
    saveSession(verified.session)
    log(verified)
  }

  async function me() {
    log('Consultando mi cuenta…')
    var user = await api('/api/v1/me')
    log(user)
  }

  async function deleteMe() {
    log('Borrando mi cuenta…')
    await api('/api/v1/me', { method: 'DELETE' })
    token = null
    window.sessionStorage.removeItem('tranqui-session-token')
    log('Cuenta borrada. Recuerda borrar el passkey en el gestor de tu dispositivo.')
  }

  document.getElementById('register').addEventListener('click', function () {
    register().catch(function (error) { log('Error: ' + error.message) })
  })
  document.getElementById('login').addEventListener('click', function () {
    login().catch(function (error) { log('Error: ' + error.message) })
  })
  document.getElementById('me').addEventListener('click', function () {
    me().catch(function (error) { log('Error: ' + error.message) })
  })
  document.getElementById('delete').addEventListener('click', function () {
    deleteMe().catch(function (error) { log('Error: ' + error.message) })
  })
})()
`

/** Test-only page for passkeys; mounted by `server.ts` for local development. */
export function createDevPasskeyPageRouter(): Router {
  const router = Router()

  router.get('/dev/passkeys', (_req, res) => {
    res.type('html').status(200).send(HTML)
  })

  router.get('/dev/passkeys.js', (_req, res) => {
    res.type('js').status(200).send(JS)
  })

  router.get('/dev/passkeys.css', (_req, res) => {
    res.type('css').status(200).send(CSS)
  })

  return router
}
