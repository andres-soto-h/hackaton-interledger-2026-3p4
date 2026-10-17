# 002 — Inicio de sesión y mi cuenta

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec aprobado; pendiente la autorización para iniciar el desarrollo.

## Contexto

La bienvenida (mockup 1.1, adaptada) es la puerta de entrada: lleva a crear
cuenta (spec 003) o a ingresar. El usuario entra con su **passkey**: el
desbloqueo de su dispositivo (huella, rostro o el PIN del dispositivo). La app
no tiene PIN ni contraseña propios. La app guarda la sesión, protege las
pantallas privadas y desde "Mi cuenta" (mockup 1.5) permite ver el permiso de
la wallet, cerrar sesión y eliminar la cuenta. Contrato en el
[backend 019](../../../backend/docs/specs/019-cuentas-usuario-passkeys.md).

## Alcance

**Incluye**
- Pantalla de bienvenida: qué es TuTranqui, "Crear cuenta" y "Ya tengo cuenta".
- Inicio de sesión con passkey, sin escribir usuario (passkeys *discoverable*).
- Módulo de passkeys (`src/features/auth/passkeys.ts`) sobre `@simplewebauthn/browser`; lo reusan el registro (003) y la confirmación de pagos (006).
- Proveedor de sesión (`SessionProvider`): token, usuario, `signIn`, `signOut`, restauración al recargar.
- Sesión en memoria + `sessionStorage` en web (decisión 5 del backend 019).
- Guard de rutas: `(app)` exige sesión; `(publico)` redirige al inicio si ya hay sesión.
- Cierre automático de sesión ante `401 SESSION_INVALID` o token vencido.
- "Mi cuenta": nombre, wallet, estado del permiso y monto diario disponible; "Quitar permiso" (desvincular la wallet); "Cerrar sesión"; "Eliminar mi cuenta".

**No incluye**
- Passkeys nativos en la app Android: en esta fase los passkeys funcionan en la web, incluido Chrome en Android ([TD-003 del backend](../../../backend/docs/DEUDA-TECNICA.md)).
- Recuperar la cuenta sin passkey.
- Vincular la wallet por primera vez (spec 003).

## Criterios de aceptación

- **Dado** un usuario registrado, **cuando** toca "Ingresar con mi passkey" y desbloquea su dispositivo, **entonces** queda con sesión y ve el inicio.
- **Dado** que cancela el diálogo del passkey, **cuando** vuelve a la app, **entonces** sigue en la pantalla de ingreso con "No se completó el ingreso. Intente de nuevo" (sin error técnico).
- **Dado** un passkey que la API no reconoce (`400 PASSKEY_VERIFICATION_FAILED`) o un desafío vencido (`400 CHALLENGE_EXPIRED`), **cuando** ingresa, **entonces** ve un mensaje para reintentar o crear una cuenta.
- **Dado** un navegador sin soporte de passkeys, **cuando** abre la bienvenida, **entonces** ve que necesita un navegador compatible (Chrome, Edge o Safari recientes) y no puede continuar.
- **Dado** una sesión vigente, **cuando** recarga la página, **entonces** sigue en la app sin volver a ingresar; al cerrar la pestaña, la sesión se pierde.
- **Dado** una sesión vencida o una llamada que responde `401`, **cuando** ocurre, **entonces** se borra la sesión y ve el ingreso con "Su sesión terminó, ingrese de nuevo".
- **Dado** que no hay sesión, **cuando** abre una ruta privada, **entonces** va a ingresar y, al ingresar, vuelve a la ruta que pidió.
- **Dado** "Mi cuenta", **cuando** la abre, **entonces** ve su nombre, su wallet, si el permiso está activo, el monto diario y cuánto le queda hoy.
- **Dado** "Quitar permiso", **cuando** confirma, **entonces** se llama `DELETE /me/wallet-link`, el permiso queda inactivo y la app le ofrece vincular de nuevo (spec 003); si responde `401 REAUTH_REQUIRED`, se le pide el passkey y se reintenta.
- **Dado** "Cerrar sesión", **cuando** confirma, **entonces** se borra la sesión, se limpia la caché de datos y ve la bienvenida.
- **Dado** "Eliminar mi cuenta", **cuando** confirma, **entonces** se llama `DELETE /me` (si responde `401 REAUTH_REQUIRED`, se pide el passkey y se reintenta), se cierra la sesión y ve "Su cuenta fue eliminada. Puede borrar el passkey desde el gestor de contraseñas de su dispositivo".

## Diseño

### Rutas

`app/(publico)/bienvenida.tsx`, `app/(publico)/ingresar.tsx`, `app/(app)/cuenta.tsx`,
guard en `app/(app)/_layout.tsx` y `app/(publico)/_layout.tsx`.

### Contrato ([backend 019](../../../backend/docs/specs/019-cuentas-usuario-passkeys.md#endpoints) y [backend 023](../../../backend/docs/specs/023-vinculacion-wallet-monto-diario.md#endpoints))

```
POST   /api/v1/auth/login/options   → 200 { challengeId, ...opciones de WebAuthn }
POST   /api/v1/auth/login/verify    { challengeId, credential } → 200 { user, session: { token, expiresAt } }
GET    /api/v1/me                   → 200 { id, displayName, walletAddress, createdAt }
DELETE /api/v1/me                   → 204 · 401 REAUTH_REQUIRED (sesión de más de 5 min)
GET    /api/v1/me/wallet-link       → estado de la vinculación
GET    /api/v1/me/allowance         → { dailyLimit, spent, available, periodStart, periodEnd }
DELETE /api/v1/me/wallet-link       → 204 · 401 REAUTH_REQUIRED
```

### Passkeys

```ts
isPasskeySupported(): Promise<boolean>
createPasskey(options): Promise<RegistrationResponseJSON>      // spec 003
getPasskeyAssertion(options): Promise<AuthenticationResponseJSON> // ingreso, reautenticación, spec 006
```

- Envuelve `startRegistration` / `startAuthentication` y traduce los errores
  del navegador (`NotAllowedError` = el usuario canceló, `InvalidStateError` =
  passkey ya registrado) a errores propios.
- En los tests se reemplaza por un fake; nunca se usa WebAuthn real.
- `reauthenticate()`: hace el flujo de ingreso para renovar la sesión cuando la
  API responde `REAUTH_REQUIRED`, y luego reintenta la acción.

### Sesión

```ts
type Session = { token: string; expiresAt: string; user: User }
useSession(): { status: "loading" | "signedIn" | "signedOut"; user?: User; signIn; signOut }
```

- `sessionStore` (`src/features/auth/storage.ts`): `sessionStorage` en web y
  una implementación en memoria para tests.
- Al iniciar, el provider registra `apiClient.setTokenProvider` y
  `apiClient.onUnauthorized(signOut)` (spec 001).
- `signOut` limpia la caché de TanStack Query.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `sessionStore` en memoria / web: guardar, leer, borrar; token vencido | Lee lo guardado; vencido → `null` |
| 2 | unit | `SessionProvider`: restaura sesión vigente, descarta vencida; `onUnauthorized` cierra sesión y limpia caché | `signedIn` / `signedOut`; caché vacía |
| 3 | unit | Módulo de passkeys con fake: éxito, cancelación, no soportado | Respuesta / `PasskeyCancelled` / `PasskeyUnsupported` |
| 4 | integration | Ingreso exitoso | `login/options` → passkey → `login/verify` con `challengeId`; navega al inicio |
| 5 | integration | Cancelación del passkey; `PASSKEY_VERIFICATION_FAILED`; `CHALLENGE_EXPIRED` | Mensaje propio de cada caso; sigue en ingreso |
| 6 | integration | Navegador sin passkeys | Mensaje de navegador compatible; sin botón de ingreso |
| 7 | integration | Ruta privada sin sesión; ruta pública con sesión; bienvenida → "Ya tengo cuenta" | Redirige a ingresar y vuelve / al inicio / a ingresar |
| 8 | integration | Mi cuenta: datos, permiso activo y disponible del día | Valores de `/me`, `/me/wallet-link` y `/me/allowance` |
| 9 | integration | Quitar permiso y eliminar cuenta, con y sin `REAUTH_REQUIRED` | Pide el passkey y reintenta; resultado esperado |
| 10 | integration | Cerrar sesión | Sesión borrada; bienvenida |
| 11 | manual | Chrome de escritorio y Chrome en Android: ingresar con passkey | Funciona con huella o PIN del dispositivo |

## Tareas

1. [ ] Handlers MSW de `/auth/login/*`, `/me`, `/me/wallet-link` y `/me/allowance`; fake de passkeys.
2. [ ] Casos 1–3 en rojo → `sessionStore`, `SessionProvider` y módulo de passkeys.
3. [ ] Casos 4–6 en rojo → bienvenida e ingreso.
4. [ ] Caso 7 en rojo → guards de rutas.
5. [ ] Casos 8–10 en rojo → Mi cuenta.
6. [ ] Verificación manual (caso 11) cuando el backend 019 esté desplegado.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Autenticación | Passkey (desbloqueo del dispositivo); la app no tiene PIN propio (2026-10-16) |
| 2 | Duración de la sesión | La que defina el backend (`SESSION_TTL_SECONDS`, 1 h por defecto); sin refresh token |
| 3 | Pedir algo antes de cada pago | El passkey confirma cada pago (spec 006) |
