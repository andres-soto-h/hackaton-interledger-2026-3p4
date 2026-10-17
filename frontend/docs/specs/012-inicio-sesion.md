# 012 — Inicio de sesión y mi cuenta

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

La bienvenida (mockup 1.1, adaptada) es la puerta de entrada: lleva a crear
cuenta (spec 011) o a ingresar. El usuario registrado entra con su correo y PIN. La app guarda la
sesión de forma segura, protege las pantallas privadas y permite cerrar sesión
y eliminar la cuenta desde "Mi cuenta" (mockup 1.5).

## Alcance

**Incluye**
- Pantalla de bienvenida: qué es TuTranqui, "Crear cuenta" y "Ya tengo cuenta".
- Pantalla de inicio de sesión: correo y PIN.
- Proveedor de sesión (`SessionProvider`): token, usuario, `signIn`, `signOut`, restauración al abrir la app.
- Almacenamiento del token: `expo-secure-store` en Android; memoria + `sessionStorage` en web ([PLAN.md](../PLAN.md#seguridad)).
- Guard de rutas: `(app)` exige sesión; `(publico)` redirige al inicio si ya hay sesión.
- Cierre automático de sesión ante `401` o token vencido.
- Pantalla "Mi cuenta": nombre, correo, wallet; "Cerrar sesión"; "Eliminar mi cuenta" con confirmación por PIN.

**No incluye**
- Recuperación del PIN, cambio de PIN, passkeys, biometría.
- Refresh tokens (la sesión dura lo que diga el backend; luego se vuelve a ingresar).

## Criterios de aceptación

- **Dado** correo y PIN correctos, **cuando** toca "Ingresar", **entonces** queda con sesión y ve el inicio.
- **Dado** credenciales incorrectas (`401 INVALID_CREDENTIALS`), **cuando** envía, **entonces** ve "El correo o el PIN no coinciden" (sin decir cuál de los dos) y el PIN se borra.
- **Dado** demasiados intentos (`429 TOO_MANY_ATTEMPTS` con `Retry-After`), **cuando** envía, **entonces** ve cuánto debe esperar y el botón queda deshabilitado ese tiempo.
- **Dado** una sesión guardada vigente, **cuando** abre la app, **entonces** entra directo al inicio sin pedir el PIN.
- **Dado** una sesión vencida, **cuando** abre la app o una llamada responde `401`, **entonces** se borra la sesión y ve la pantalla de ingreso con "Su sesión terminó, ingrese de nuevo".
- **Dado** que no hay sesión, **cuando** abre una ruta privada (p. ej. `/transacciones` en web), **entonces** va a ingresar y, al ingresar, vuelve a la ruta que pidió.
- **Dado** "Cerrar sesión", **cuando** confirma, **entonces** se borra el token del almacenamiento, se limpia la caché de datos y ve la bienvenida.
- **Dado** "Eliminar mi cuenta", **cuando** escribe su PIN y confirma, **entonces** se llama `DELETE /users/me`, se cierra la sesión y ve "Su cuenta fue eliminada".

## Diseño

### Rutas

`app/(publico)/bienvenida.tsx`, `app/(publico)/ingresar.tsx`, `app/(app)/cuenta.tsx`, guard en
`app/(app)/_layout.tsx` y `app/(publico)/_layout.tsx`.

### Contrato (propuesto al backend)

```
POST   /api/v1/sessions   { "email", "pin" }  → 200 { user, token, expiresAt }
                          401 INVALID_CREDENTIALS · 429 TOO_MANY_ATTEMPTS (Retry-After)
GET    /api/v1/users/me   → 200 { user }
DELETE /api/v1/users/me   { "pin" } → 204 · 401 INVALID_CREDENTIALS
```

### Sesión

```ts
type Session = { token: string; expiresAt: string; user: User }
useSession(): { status: "loading" | "signedIn" | "signedOut"; user?: User; signIn; signOut }
```

- `sessionStore` (`src/features/auth/storage.ts`) con una implementación por
  plataforma (`storage.native.ts` / `storage.web.ts`) y una en memoria para tests.
- Al iniciar, el provider registra `apiClient.setTokenProvider` y
  `apiClient.onUnauthorized(signOut)` (spec 010).
- `signOut` también limpia la caché de TanStack Query para no mostrar datos de
  otro usuario.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Storage en memoria / web: guardar, leer, borrar; token vencido | Lee lo guardado; vencido → `null` |
| 2 | unit | `SessionProvider`: restaura sesión vigente, descarta vencida | `signedIn` / `signedOut` |
| 3 | unit | `SessionProvider`: `onUnauthorized` dispara `signOut` y limpia caché | Sesión borrada, caché vacía |
| 4 | integration | Ingreso exitoso | `POST /sessions` con correo normalizado; navega al inicio |
| 5 | integration | `401 INVALID_CREDENTIALS` | Mensaje genérico; PIN vacío |
| 6 | integration | `429` con `Retry-After: 60` | Mensaje con la espera; botón deshabilitado |
| 7 | integration | Ruta privada sin sesión | Redirige a ingresar y luego vuelve a la ruta pedida |
| 8 | integration | Ruta pública con sesión; bienvenida sin sesión → "Ya tengo cuenta" | Redirige al inicio; navega a ingresar |
| 9 | integration | Cerrar sesión | Token borrado; bienvenida |
| 10 | integration | Eliminar cuenta con PIN correcto / incorrecto | `DELETE /users/me` → bienvenida / error en el PIN |
| 11 | manual | Android: cerrar y abrir la app con sesión | Entra sin pedir PIN |

## Tareas

1. [ ] Handlers MSW de `/sessions` y `/users/me`.
2. [ ] Casos 1–3 en rojo → storage por plataforma y `SessionProvider`.
3. [ ] Casos 4–6 en rojo → pantalla de ingreso.
4. [ ] Casos 7–8 en rojo → bienvenida y guards de rutas.
5. [ ] Casos 9–10 en rojo → Mi cuenta.
6. [ ] Verificación manual (caso 11) y contrato propuesto al backend.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Duración de la sesión:** recomendación 1 h (pagos con aprobación en la
   wallet, el riesgo de una sesión robada es limitado pero real).
2. **Pedir el PIN antes de cada pago:** los mockups no lo hacen y la aprobación
   ya ocurre en la wallet. Recomendación: no pedirlo.
