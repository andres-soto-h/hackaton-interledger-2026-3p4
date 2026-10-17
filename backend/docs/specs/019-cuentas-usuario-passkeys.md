# 019 — Cuentas de usuario con passkeys

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

Lote 1 integrado en `develop-andres` (2026-10-17): tareas 3–6 hechas; tareas 1 (solo memoria) y 7 (solo rutas públicas) parciales. Falta el lote 2: repositorio DynamoDB, adapter de SimpleWebAuthn, `openapi.yaml` y página HTML de prueba. Marca `[~]` = parcial.

0 / 9 tareas completadas. Ajustado el 2026-10-16 por el monto diario
preaprobado (spec 023); Cambios aprobados el 2026-10-16.

**Qué cambió respecto a la versión aprobada:** después de registrarse, el
usuario vincula su wallet (spec 023), y eso verifica que la wallet es suya;
borrar la cuenta cancela ese permiso; los pagos y las consultas exigen la sesión. Depende de
los specs 001, 004 y 005. Requiere cambios de infraestructura en el spec 002.

## Contexto

La app necesita que las personas creen su cuenta, inicien sesión y puedan
borrarla. Se usan **passkeys** (WebAuthn): el usuario se registra con el
desbloqueo de su dispositivo (PIN, huella o rostro) y la API guarda solo una
llave pública. No hay contraseñas que guardar, filtrar o recuperar.

**El PIN es el del dispositivo, no uno de la app.** El sistema operativo lo
verifica localmente; la API nunca lo ve. Solo recibe una firma que demuestra
"este dispositivo, desbloqueado por su dueño, es el que se registró".

**Frontend:** React Native con salida web. En esta fase los passkeys funcionan
en la web (escritorio y Chrome en Android, que guarda el passkey en el
Administrador de contraseñas de Google y lo sincroniza). Los passkeys nativos
dentro de la app Android quedan como deuda técnica (TD-003).

**Registro completo = cuenta + vinculación de la wallet.** Después de crear el
passkey, la app lleva al usuario a aprobar el monto diario en su wallet (spec
023). Hasta entonces la cuenta existe pero no puede pagar. La sesión por sí sola
no da acceso a fondos: los pagos usan el permiso aprobado en la wallet y la
confirmación del usuario (spec 007).

## Alcance

**Incluye**
- Registro con passkey: nombre visible y wallet address.
- Inicio de sesión con passkey, sin nombre de usuario (passkeys *discoverable*).
- Sesión con JWT propio firmado con un secreto de Secrets Manager.
- `GET /api/v1/me` y `DELETE /api/v1/me`.
- Middleware `userAuth` y puerto `UsersRepository` (memoria + DynamoDB).
- Cambios de infraestructura listados en [Impacto en infraestructura](#impacto-en-infraestructura).

**No incluye**
- Vincular la wallet y verificar que es del usuario (spec 023; resuelve TD-002).
- Recuperar la cuenta sin un passkey (TD-004).
- Passkeys nativos en la app Android (TD-003).
- Usar la sesión en los endpoints de pagos y transacciones (ver
  [Impacto en otros specs](#impacto-en-otros-specs)).
- Administración de usuarios (spec 021).

## Criterios de aceptación

- **Dado** un usuario nuevo, **cuando** completa el registro con su passkey,
  **entonces** se crea la cuenta con su wallet, se guarda la llave pública y
  recibe una sesión.
- **Dado** un usuario registrado, **cuando** inicia sesión con su passkey,
  **entonces** recibe una sesión sin escribir usuario ni contraseña.
- **Dado** un desafío (*challenge*) ya usado, vencido o de otro origen,
  **cuando** se verifica, **entonces** se rechaza.
- **Dado** una sesión válida, **cuando** llama `GET /me`, **entonces** recibe sus datos.
- **Dado** una sesión de una cuenta borrada o bloqueada, **cuando** llama a la
  API, **entonces** recibe `401`.
- **Dado** un usuario que borra su cuenta, **cuando** termina, **entonces** se
  eliminan su cuenta y sus passkeys, y sus pagos se conservan sin vínculo a él.
- **Dado** una wallet ya asociada a otra cuenta, **cuando** alguien se registra
  con ella, **entonces** responde `409 WALLET_ALREADY_REGISTERED`.

## Diseño

### Flujo

```
Registro                                       Inicio de sesión
App ─ POST /auth/register/options ─▶ API       App ─ POST /auth/login/options ─▶ API
App ◀─ options (challenge) ──────────          App ◀─ options (challenge) ──────
Dispositivo crea el passkey (PIN/huella)       Dispositivo firma (PIN/huella)
App ─ POST /auth/register/verify ──▶ API       App ─ POST /auth/login/verify ──▶ API
App ◀─ { user, session } ─────────────         App ◀─ { user, session } ─────────
```

### Endpoints

| Método y ruta | Auth | Body | Respuesta |
|---|---|---|---|
| `POST /api/v1/auth/register/options` | Pública | `{ displayName, walletAddress }` | `200` opciones de WebAuthn + `challengeId` |
| `POST /api/v1/auth/register/verify` | Pública | `{ challengeId, credential }` | `201 { user, session }` |
| `POST /api/v1/auth/login/options` | Pública | — | `200` opciones + `challengeId` |
| `POST /api/v1/auth/login/verify` | Pública | `{ challengeId, credential }` | `200 { user, session }` |
| `GET /api/v1/me` | Sesión | — | `200 { id, displayName, walletAddress, createdAt }` |
| `DELETE /api/v1/me` | Sesión reciente | — | `204` |

`session` = `{ token, expiresAt }`. El frontend la envía como
`Authorization: Bearer <token>`.

### Reglas de WebAuthn (con `@simplewebauthn/server`)

| Regla | Valor |
|---|---|
| `rpID` / `rpName` | `WEBAUTHN_RP_ID` (dominio del frontend) / `Tranqui` |
| Orígenes aceptados | `WEBAUTHN_ORIGINS` (lista exacta) |
| `residentKey` | `required` (permite iniciar sesión sin usuario) |
| `userVerification` | `required` (exige PIN, huella o rostro) |
| Algoritmos | ES256 y RS256 |
| `attestation` | `none` |
| Challenge | Aleatorio, guardado con TTL de 5 min, **un solo uso** (se borra con condición al verificar) |
| Contador | Se guarda y se rechaza si retrocede (posible passkey clonado); los passkeys sincronizados usan 0 |

En el registro, la wallet pasa por `assertSafeWalletUrl` y `getWalletAddress`
(spec 003) para confirmar que existe, y se guarda su moneda.

### Sesión (JWT)

- HS256 con el secreto `session-signing-key` de Secrets Manager; algoritmo fijo
  al verificar.
- Claims: `sub` (userId), `iss` = `tranqui-api`, `aud` = `tranqui-app`, `iat`,
  `exp` (`SESSION_TTL_SECONDS`, por defecto 3600).
- `userAuth` verifica el JWT **y** que la cuenta exista y esté activa (una
  lectura en DynamoDB). Así, borrar o bloquear una cuenta corta sus sesiones de
  inmediato, aunque el JWT no haya vencido.
- `DELETE /me` exige una sesión de menos de 5 minutos (`iat`); si no,
  `401 REAUTH_REQUIRED` y el frontend pide el passkey otra vez.
- Sin refresh token: al vencer, el usuario vuelve a usar su passkey (es un toque).

### Entidades (misma tabla del spec 004)

| Entidad | ID | Campos |
|---|---|---|
| `User` | `usr_<ulid>` | displayName, walletAddress, walletAssetCode, status (`ACTIVE` · `BLOCKED`), createdAt, updatedAt |
| `Credential` | `cred_<credentialId>` | userId, publicKey, counter, transports, deviceType, backedUp, createdAt, lastUsedAt |
| `Challenge` | `chl_<ulid>` | challenge, type (`register` · `login` · `payment_confirmation`, spec 007), datos pendientes del registro, expiresAt (TTL) |
| Unicidad de wallet | `wal_<sha256(walletAddress)>` | userId (se crea en la misma transacción que el usuario) |

Todas llevan `entityType` y `createdAt` para el índice `byType` (listar usuarios
en el spec 021). Los passkeys de un usuario se buscan con el índice `byUser`
(`userId` + `createdAt`).

### Borrar la cuenta

Transacción que elimina `User`, sus `Credential` y el registro de unicidad de
la wallet. Los pagos y solicitudes quedan (el dinero ya se movió en Open
Payments) porque se relacionan por wallet, no por usuario. El passkey queda en
el dispositivo del usuario; la respuesta lo indica para que el frontend le
sugiera borrarlo desde su gestor de contraseñas.

### Errores nuevos

| Código | HTTP | Cuándo |
|---|---|---|
| `PASSKEY_VERIFICATION_FAILED` | 400 | Firma, origen, rpID o contador inválidos |
| `CHALLENGE_EXPIRED` | 400 | Challenge vencido, usado o inexistente |
| `SESSION_INVALID` | 401 | Sin sesión, JWT inválido o vencido, cuenta borrada o bloqueada |
| `REAUTH_REQUIRED` | 401 | Acción sensible con sesión de más de 5 minutos |
| `WALLET_ALREADY_REGISTERED` | 409 | La wallet ya tiene cuenta |

### Impacto en infraestructura

Cambios en el spec 002 (tareas 17–19):

| Recurso | Cambio |
|---|---|
| Secret `tranqui/<stage>/session-signing-key` | Nuevo; generado por AWS (64 caracteres); la Lambda solo puede leerlo |
| Tabla | Índices `byType` (`entityType` + `createdAt`) y `byUser` (`userId` + `createdAt`) |
| Lambda | Variables `SESSION_SECRET_ARN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`, `SESSION_TTL_SECONDS` |

### Impacto en otros specs

- **001:** el middleware de API key debe dejar pasar las rutas
  `/api/v1/auth/register/*`, `/api/v1/auth/login/*` y `/api/v1/me` (esta última
  usa `userAuth`).
- **005:** `CORS_ALLOWED_ORIGINS` debe incluir el origen del frontend; el log
  redacta `authorization` (ya incluido).
- **007 y 008:** los pagos y las consultas exigen la sesión; el emisor y el
  historial salen de la wallet de la cuenta.
- **023:** `DELETE /me` cancela el grant de la vinculación en Open Payments
  antes de borrar la cuenta.

## Casos de prueba

La verificación criptográfica se aísla detrás de un puerto `PasskeyVerifier`
(adapter con SimpleWebAuthn), así los servicios se prueban con un fake. El
adapter se prueba con respuestas de WebAuthn grabadas.

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Opciones de registro con datos válidos | `rpID`, `residentKey: required`, `userVerification: required`; challenge guardado con TTL |
| 2 | Integration | Opciones de registro con wallet inexistente / no permitida | `422 WALLET_NOT_FOUND` / `WALLET_NOT_ALLOWED` |
| 3 | Integration | Verificar registro válido | `201`; usuario, passkey y unicidad de wallet guardados; sesión válida |
| 4 | Integration | Verificar con challenge usado, vencido o inexistente | `400 CHALLENGE_EXPIRED`; nada creado |
| 5 | Integration | Verificación de WebAuthn fallida (origen, rpID, firma) | `400 PASSKEY_VERIFICATION_FAILED` |
| 6 | Integration | Registro con wallet ya registrada | `409 WALLET_ALREADY_REGISTERED` |
| 7 | Integration | Login válido | `200`; sesión; `lastUsedAt` y contador actualizados |
| 8 | Integration | Login con passkey desconocido o contador que retrocede | `400 PASSKEY_VERIFICATION_FAILED` |
| 9 | Integration | Login de usuario bloqueado | `401 SESSION_INVALID` |
| 10 | Integration | `GET /me` con sesión válida / sin sesión / JWT alterado / vencido / `alg: none` | `200` / `401` en los demás |
| 11 | Integration | Sesión de una cuenta ya borrada | `401 SESSION_INVALID` |
| 12 | Integration | `DELETE /me` con sesión reciente / antigua | `204` y todo borrado (pagos intactos) / `401 REAUTH_REQUIRED` |
| 13 | Integration | Dos verificaciones en paralelo con el mismo challenge | Solo una tiene éxito |
| 14 | Contrato | `UsersRepository` en memoria y DynamoDB | Mismos resultados |
| 15 | Adapter | `PasskeyVerifier` con respuestas grabadas de registro y login | Acepta las válidas; rechaza origen y rpID distintos |
| 16 | Manual | Registro, login y borrado desde Chrome escritorio y Chrome Android | Funciona con PIN/huella del dispositivo |

## Tareas

1. [~] Entidades, `UsersRepository` y tests de contrato (caso 14) → memoria y DynamoDB.
2. [ ] Puerto `PasskeyVerifier` y adapter con SimpleWebAuthn (caso 15).
3. [x] Servicio de sesión (emitir y verificar JWT) y middleware `userAuth` (casos 10–11).
4. [x] Registro: casos 1–6 y 13 en rojo → implementación.
5. [x] Login: casos 7–9 en rojo → implementación.
6. [x] `GET /me` y `DELETE /me` (caso 12).
7. [~] Contrato en `openapi.yaml`; ajustar rutas públicas del spec 001.
8. [ ] Página HTML mínima de prueba en local para el caso 16 (mientras no existe el frontend).
9. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Mecanismo | Passkeys con SimpleWebAuthn (2026-10-16) |
| 2 | Sesión | JWT propio con secreto de firma en Secrets Manager (2026-10-16) |
| 3 | Aprobación de pagos | Una vez al vincular la wallet, con monto diario (spec 023); cada pago se confirma con el passkey (spec 007) |
| 4 | PIN | El del dispositivo; la app no tiene PIN propio |
| 5 | Dónde guarda el frontend la sesión | En memoria y `sessionStorage` (2026-10-16) |
| 6 | Dominio (`WEBAUTHN_RP_ID`) | El de la distribución de **CloudFront** que sirve el frontend web (`dXXXX.cloudfront.net`), sin comprar dominio (2026-10-16). La distribución no se debe destruir: si su nombre cambia, todos los passkeys dejan de servir |
| 7 | Confirmación de pagos | El mismo passkey firma cada confirmación de pago (spec 007) |

## Decisiones pendientes

Ninguna. El nombre exacto de la distribución de CloudFront se configura en
`WEBAUTHN_RP_ID` y `WEBAUTHN_ORIGINS` cuando se cree (lo define el despliegue
del frontend); en local se usa `localhost`.

## Notas

- Referencias: [SimpleWebAuthn](https://simplewebauthn.dev) ·
  [passkeys.dev](https://passkeys.dev) ·
  [WebAuthn en Android](https://developer.android.com/identity/passkeys).
