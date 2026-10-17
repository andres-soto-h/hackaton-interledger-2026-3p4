# 003 — Registro y vinculación de la wallet

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

6 / 7 tareas completadas en la rama `front/003` (142 tests en verde, lint y typecheck limpios). **Solo falta la verificación manual (tarea 6, caso 9)**: registro completo en Chrome con una wallet de la red de prueba y el backend 019/023 desplegado; pendiente del responsable. Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar el frontend).

## Contexto

El usuario crea su cuenta con su nombre, la dirección de su wallet y un
**passkey** (el desbloqueo de su dispositivo; no hay PIN de la app). Después
**vincula su wallet**: aprueba una sola vez, en su wallet, que TuTranqui pague
hasta un monto diario. Desde ahí cada pago se confirma en la app con el passkey,
sin volver a la wallet (specs 006 y 008). El registro completo es cuenta +
vinculación; sin vinculación la cuenta existe pero no puede pagar.

Este flujo corresponde a los mockups 1.2 – 1.4 ("Su banco", "Autoriza en su
banco", "Permiso guardado"), adaptados a wallet y monto diario. El usuario
**no** entrega llaves ni la clave de su wallet: solo su dirección pública.
Contratos en el [backend 019](../../../backend/docs/specs/019-cuentas-usuario-passkeys.md)
y el [backend 023](../../../backend/docs/specs/023-vinculacion-wallet-monto-diario.md).

## Alcance

**Incluye**
- Paso 1 · Sus datos: nombre y dirección de la wallet, con validación en el cliente (Zod).
- Paso 2 · Su passkey: explicación corta ("Use la huella o el bloqueo de su teléfono") y creación del passkey.
- Paso 3 · Permiso en su wallet: muestra el monto diario y lo que TuTranqui podrá y no podrá hacer (mockup 1.3); abre la `authorizationUrl` de la wallet.
- Vuelta desde la wallet: ruta de resultado de la vinculación, consulta del estado hasta que sea final y pantalla "Permiso guardado" (mockup 1.4).
- Retomar la vinculación si el usuario la abandonó, la rechazó o se venció: aviso en el inicio "Vincule su wallet para empezar a pagar" y desde Mi cuenta (spec 002).
- Wallets en cualquier moneda soportada (multimoneda).

**No incluye**
- Bienvenida, ingreso, desvincular y eliminar la cuenta (spec 002).
- Cambiar el monto diario (se fija al vincular; para tomar uno nuevo se vuelve a vincular).
- Recuperar la cuenta sin passkey.

## Criterios de aceptación

- **Dado** el paso 1 vacío, **cuando** toca "Seguir", **entonces** cada campo muestra su error y no se llama a la API.
- **Dado** una dirección de wallet sin `https://` o mal formada, **cuando** sale del campo, **entonces** ve el error; si escribe `$ilp.interledger-test.dev/ana`, se normaliza a `https://ilp.interledger-test.dev/ana`.
- **Dado** datos válidos, **cuando** toca "Seguir", **entonces** se pide `POST /auth/register/options`; si la wallet no existe o no está permitida (`422 WALLET_NOT_FOUND` / `WALLET_NOT_ALLOWED`), ve el error en el campo de la wallet.
- **Dado** una wallet que ya tiene cuenta (`409 WALLET_ALREADY_REGISTERED`), **cuando** sigue, **entonces** ve el error y un enlace a "Ingresar".
- **Dado** el paso 2, **cuando** crea el passkey, **entonces** se llama `POST /auth/register/verify`, queda con sesión y pasa al paso 3; si cancela el diálogo, sigue en el paso 2 y puede reintentar.
- **Dado** el paso 3, **cuando** lo abre, **entonces** ve qué podrá y qué no podrá hacer TuTranqui y "Cada pago lo confirma usted en la app". El monto diario se muestra al volver de la wallet (y la wallet lo muestra al pedir el permiso): el backend no lo expone antes de vincular (ver *Pendientes del backend*).
- **Dado** "Ir a mi wallet", **cuando** lo toca, **entonces** se llama `POST /me/wallet-link` y el navegador va a la `authorizationUrl` (solo si es `https`).
- **Dado** que aprueba en su wallet, **cuando** vuelve a la app, **entonces** ve "Su wallet autorizó a TuTranqui", el monto diario y "Empezar a pagar".
- **Dado** que rechaza o se vence el tiempo, **cuando** vuelve, **entonces** ve qué pasó y "Intentar de nuevo".
- **Dado** que la moneda de su wallet no tiene monto diario configurado (`422 CURRENCY_NOT_SUPPORTED`), **cuando** intenta vincular, **entonces** ve que esa moneda todavía no está disponible.
- **Dado** que cerró la app en el paso 3, **cuando** vuelve a ingresar, **entonces** el inicio le muestra el aviso para vincular y no puede pagar hasta hacerlo.

## Diseño

### Rutas

`app/(publico)/registro.tsx` (pasos 1 y 2), `app/(app)/vincular/index.tsx`
(paso 3) y `app/(app)/vincular/resultado.tsx` (vuelta desde la wallet; es la
`FRONTEND_RESULT_URL` del backend).

### Formulario

| Campo | Regla | Teclado |
|---|---|---|
| Nombre | 2–60 caracteres, sin solo espacios | texto, `autoComplete="name"` |
| Dirección de la wallet | `https://` + host + ruta; acepta *payment pointer* `$host/ruta` y lo normaliza | `url`, sin autocorrección |

El schema vive en `src/features/auth/schemas.ts`.

### Contrato

```
POST /api/v1/auth/register/options  { displayName, walletAddress } → 200 { challengeId, ...opciones }
                                     422 WALLET_NOT_FOUND | WALLET_NOT_ALLOWED · 409 WALLET_ALREADY_REGISTERED
POST /api/v1/auth/register/verify   { challengeId, credential } → 201 { user, session }
POST /api/v1/me/wallet-link         → 202 { linkId, authorizationUrl, dailyLimit, expiresAt }
                                     409 WALLET_ALREADY_LINKED · 422 CURRENCY_NOT_SUPPORTED
GET  /api/v1/me/wallet-link         → { status, dailyLimit, ... } + isFinal / Retry-After mientras está pendiente
Vuelta: FRONTEND_RESULT_URL?linkId=…&status=…
```

- El `status` de la vuelta es solo el estado inicial; lo que se muestra como
  final viene de `GET /me/wallet-link` (el query se puede manipular).
- Estados: `PENDING_AUTHORIZATION`, `ACTIVE`, `REJECTED`, `EXPIRED`, `REVOKED`.
- Los passkeys usan el módulo del spec 002.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Schema: nombre; normalización de wallet (`$host/ruta`, `https://`, espacios, `http://`) | Acepta válidos; `http://` y mal formadas rechazadas |
| 2 | unit | Polling del estado de la vinculación con reloj falso | Respeta `Retry-After`; se detiene en estado final |
| 3 | integration | Paso 1 vacío; wallet inexistente; wallet ya registrada | Errores por campo / en la wallet / enlace a ingresar; sin passkey |
| 4 | integration | Paso 2: passkey creado / cancelado | `register/verify` y sesión → paso 3 / sigue en paso 2 |
| 5 | integration | Paso 3 → "Ir a mi wallet" | `POST /me/wallet-link`; navega a la `authorizationUrl`; `http` rechazada |
| 6 | integration | Vuelta con `ACTIVE`, `REJECTED`, `EXPIRED`; query que dice `ACTIVE` pero la API dice pendiente | Pantalla de cada estado; manda la API |
| 7 | integration | Usuario sin vinculación en el inicio; `CURRENCY_NOT_SUPPORTED` | Aviso para vincular / mensaje de moneda no disponible |
| 8 | integration | Doble toque en "Seguir" o "Ir a mi wallet" | Una sola petición |
| 9 | manual | Registro completo en Chrome con una wallet de la red de prueba | Cuenta creada, wallet vinculada y "Permiso guardado" |

## Tareas

1. [x] Handlers MSW de `/auth/register/*` y `/me/wallet-link` con fixtures por estado.
2. [x] Caso 1 en rojo → schema y normalización de wallet.
3. [x] Casos 3–4 en rojo → pasos 1 y 2.
4. [x] Casos 2 y 5–6 en rojo → paso 3 y vuelta desde la wallet.
5. [x] Casos 7–8 en rojo → aviso de vinculación pendiente y doble envío.
6. [~] Verificación manual (caso 9) cuando los backend 019 y 023 estén desplegados: pendiente.
7. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Autenticación | Passkey; la app no tiene PIN propio (2026-10-16) |
| 2 | Monedas | Multimoneda: se acepta cualquier moneda con monto diario configurado en el backend; se muestra con su código (2026-10-16) |
| 3 | Aprobación de pagos | Una sola vez al vincular la wallet, con monto diario (backend 023); cada pago se confirma con el passkey (2026-10-16) |
| 4 | Correo | No se pide: el backend 019 no lo requiere y el ingreso es con passkey. Si más adelante hace falta, se agrega en backend 019 y en este spec a la vez (2026-10-17) |
| 5 | Passkeys en Android | Solo desde Chrome en esta fase; los passkeys en app nativa son deuda técnica del backend (TD-003) (2026-10-17) |

## Notas

- Depende de 001 y 002 (sesión y passkeys).
- El backend 019 no pide correo: el registro es con nombre y wallet, y el ingreso
  es con el passkey, sin usuario.
- Si la sesión se abre en `/registro`, el guard de `(publico)` lleva a `/vincular` (paso 3) en vez de al inicio.
- En web, "Ir a mi wallet" navega en la misma pestaña (`window.location.assign`) para que la vuelta
  caiga en `/vincular/resultado`; en Android nativo usa `Linking.openURL`.

## Pendientes del backend (para validar con el responsable)

- **Monto diario antes de vincular:** el paso 3 no puede mostrar el monto diario porque
  `GET /me/wallet-link` responde `404` y `GET /me/allowance` depende de una vinculación. Se
  propone exponerlo antes (p. ej. `dailyLimit` en `GET /me` o `GET /me/allowance` sin vinculación).
  Mientras tanto el monto aparece al volver de la wallet.
