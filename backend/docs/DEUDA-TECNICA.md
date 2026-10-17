# Deuda técnica

Decisiones tomadas a conciencia para avanzar, que deben revisarse más adelante.
Cada ítem indica su origen, el riesgo de dejarlo así y la solución propuesta.
Cuando se aborde, se convierte en un spec.

| ID | Tema | Estado |
|---|---|---|
| TD-001 | Autenticación de la API más fuerte que la API key | Abierta |
| TD-002 | Verificar que la wallet registrada es del usuario | Abierta |
| TD-003 | Passkeys nativos en la app Android (React Native) | Abierta |
| TD-004 | Recuperar la cuenta sin un passkey | Abierta |
| TD-005 | Administradores individuales en vez de una clave compartida | Abierta |

## TD-001 — Autenticación de la API más fuerte que la API key

- **Registrada:** 2026-10-16 · **Origen:** spec 002 (antes tarea "evaluar JWT").
- **Decisión actual:** API key compartida en el header `x-api-key` (spec 001),
  guardada en Secrets Manager (spec 002).
- **Riesgo:** es un secreto compartido de larga duración. Si se filtra (logs,
  configuración del agente, repositorio), cualquiera puede usar la API hasta que
  se rote. No identifica qué consumidor hizo cada petición.
- **Mitigaciones actuales:** HTTPS, comparación en tiempo constante, rotación
  documentada, ningún pago se ejecuta sin la aprobación interactiva del dueño de
  la wallet.
- **Solución propuesta:** como el consumidor corre en Google Cloud, usar ID
  tokens OIDC de una service account de Google: JWT firmados por Google, de
  corta duración, verificados con las llaves públicas de Google y validando
  `aud`, `iss` y `exp`. Elimina el secreto compartido.
- **Por qué no ahora:** requiere configurar la service account y la audiencia
  en Google Cloud, y la verificación de tokens en la API; se prioriza tener el
  flujo de pagos funcionando.

## TD-002 — Verificar que la wallet registrada es del usuario

- **Registrada:** 2026-10-16 · **Origen:** spec 019.
- **Decisión actual:** al registrarse, la API solo comprueba que la wallet
  exista y no tenga otra cuenta. No comprueba que sea de quien se registra.
- **Riesgo:** una wallet address es pública. Alguien puede registrarse con la
  wallet de otra persona y, si la app muestra el historial por la wallet de la
  cuenta, ver los pagos hechos por la app hacia o desde esa wallet. Además,
  bloquea a su dueño real (`WALLET_ALREADY_REGISTERED`).
- **Mitigaciones actuales:** los pagos no corren riesgo: cada débito lo aprueba
  el dueño real en su wallet. El administrador puede corregir o borrar cuentas
  (spec 021).
- **Solución propuesta:** al registrarse, pedir un grant interactivo con
  `identifier` = la wallet del usuario (por ejemplo, de lectura de incoming
  payments). Solo su dueño puede aprobarlo; al volver el callback, la wallet
  queda verificada. Reutiliza el callback y la verificación del hash del spec 007.
- **Por qué no ahora:** agrega un paso al registro y otro flujo de callback; se
  prioriza el flujo de pagos.

## TD-003 — Passkeys nativos en la app Android (React Native)

- **Registrada:** 2026-10-16 · **Origen:** spec 019.
- **Decisión actual:** los passkeys funcionan en la versión web (escritorio y
  Chrome en Android). La app nativa no los soporta todavía.
- **Riesgo:** si se distribuye la app nativa, sus usuarios no pueden registrarse
  ni iniciar sesión.
- **Solución propuesta:** una librería de passkeys para React Native sobre
  Credential Manager de Android; publicar `/.well-known/assetlinks.json` en el
  dominio de `WEBAUTHN_RP_ID` con el paquete y la huella del certificado de
  firma; agregar el origen `android:apk-key-hash:…` a `WEBAUTHN_ORIGINS`.
  Requiere un build propio (no funciona en Expo Go).
- **Por qué no ahora:** depende de la firma de la app y del dominio definitivo,
  y es difícil de depurar; la web responsive cubre Android mientras tanto.

## TD-004 — Recuperar la cuenta sin un passkey

- **Registrada:** 2026-10-16 · **Origen:** spec 019.
- **Decisión actual:** si el usuario pierde todos sus dispositivos y su passkey
  no estaba sincronizado, no puede entrar. El administrador puede restablecer el
  acceso con un enlace (spec 021).
- **Riesgo:** depende de que el usuario contacte al equipo y de que alguien
  verifique su identidad a mano; quien tenga el enlace toma la cuenta.
- **Solución propuesta:** recuperación por la propia wallet: el usuario aprueba
  un grant interactivo en su wallet (igual que TD-002) y con eso registra un
  passkey nuevo. Además, permitir varios passkeys por cuenta desde la app.
- **Por qué no ahora:** depende de TD-002.

## TD-005 — Administradores individuales en vez de una clave compartida

- **Registrada:** 2026-10-16 · **Origen:** spec 020.
- **Decisión actual:** una sola clave de administrador en Secrets Manager.
- **Riesgo:** no se sabe qué persona hizo cada cambio; si la clave se filtra hay
  que rotarla para todos; una clave es más débil que un passkey.
- **Mitigaciones actuales:** bloqueo tras 5 intentos fallidos, cookie
  `HttpOnly` y `SameSite=Strict`, CSRF, historial de cambios, `ADMIN_ENABLED=false`
  para apagar el panel.
- **Solución propuesta:** administradores como usuarios del spec 019 con rol
  `admin` y passkey; el primero se crea con un enlace de registro generado desde
  la CLI.
- **Por qué no ahora:** la clave compartida basta para la demo.
