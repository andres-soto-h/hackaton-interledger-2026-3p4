# Memoria compartida entre specs en paralelo

Decisiones y cambios que afectan a más de un spec en desarrollo. Es obligatoria
para todos los agentes: el orquestador y los workers la leen antes de cada tarea.

- **Un solo escritor:** solo el orquestador edita este archivo. Los workers
  proponen en `.orquestacion/PROPUESTAS.md` de su worktree.
- **Propagación:** después de cada cambio, el orquestador corre
  `orquestacion/scripts/deepseek-worker.sh sync` y avisa con `continue` a los
  workers afectados.
- Entradas nuevas arriba. Una entrada se marca *Reemplazada* en lugar de borrarse.

Formato:

```
### AAAA-MM-DD · <título corto>
- Origen: spec NNN (worker | orquestador | responsable)
- Afecta: specs NNN, NNN · archivos/módulos
- Decisión: …
- Acción para los demás: … (o "ninguna")
```

## Specs en paralelo

| Spec | Rama | Worktree | Desde | Lote actual |
|---|---|---|---|---|
| 002 | `spec/002` | `../<repo>-worktrees/spec-002` | 2026-10-16 | Tareas 17–21 (secretos generados, índices de usuarios y eventos, configuración de passkeys/panel/monto diario/comisión) |
| 020 | `spec/020` | `../<repo>-worktrees/spec-020` | 2026-10-17 | Panel admin: base, configuración y `ActivityLog` |

> El spec 002 está **pausado** (2026-10-17) y no cuenta para el límite de 3; su worktree sigue disponible.
| 023 | `spec/023` | `../<repo>-worktrees/spec-023` | 2026-10-17 | Vinculación de wallet y monto diario (con fakes) |
| 021 | `spec/021` | `../<repo>-worktrees/spec-021` | 2026-10-17 | Panel admin: gestión de usuarios |

## Decisiones

### 2026-10-17 · Decisiones del 021 que afectan a otros specs
- Origen: spec 021 (agente de tests)
- Afecta: specs 019 (ya Hecho), 020, 023, 007+
- Decisión: `User.sessionVersion` opcional y claim `sv` en el JWT (si se pasa); `userAuth` rechaza tokens cuya versión no coincida con la del usuario (los viejos valen como versión 0). `UsersRepository` gana `createUser`, `listUsers`, `updateUser`, `bumpSessionVersion`, `addCredential`, `deleteCredentials` y 4 métodos de enlaces de registro (solo hash, 24 h). `register/options` acepta `{displayName, walletAddress}` o `{enrollmentToken}`. El 021 monta `createAdminUsersRouter(deps)` aparte (no toca `admin.routes.ts`) y añade el enlace "Usuarios" en `layout.ts`. Puertos opcionales `walletLinks` y `payments` en el detalle: el cableado real lo hace el orquestador.
- Acción para los demás: el 020 lote 2 no cambia `layout.ts`; 007 y siguientes usan `userAuth` con `sessionVersion`.

### 2026-10-17 · Dueños de archivos del spec 021
- Origen: orquestador
- Afecta: specs 020 (lote 2), 021, 023
- Decisión: el **021** es dueño de `src/modules/users/` (extiende `UsersRepository` y sus dos implementaciones, ya sin 019 activo), de `src/modules/admin/admin-users.*` (archivos nuevos: rutas, vistas, servicio; exporta `createAdminUsersRouter(deps)` que se monta bajo `/admin/users`) y del enlace de registro en `auth`. No edita `admin.routes.ts` (020), ni app.ts/server.ts/lambda.ts/config. Si necesita un hook del panel (menú, layout) lo pide a PROPUESTAS.md. El 020 lote 2 es dueño de `modules/admin/admin-home.*`, `shared/activity/dynamo-*` y `shared/settings/dynamo-*`; el 023 de `modules/wallet-links/` y `integrations/open-payments/`.
- Acción para los demás: ninguna.

### 2026-10-17 · Archivos compartidos que toca el 023 (y el 019 lote 2 y 020)
- Origen: orquestador (aviso del agente del 023)
- Afecta: specs 019 (lote 2), 020, 023 · `api-key-auth.ts`, `ids.ts`, `modules/users/me.routes.ts`, `users.service.ts`, `integrations/open-payments/errors.ts`
- Decisión: cambios aditivos y mínimos, el orquestador resuelve conflictos al integrar:
  - **023**: `api-key-auth.ts` suma rutas públicas de wallet-link y allowance; `ids.ts` suma `wl`; `createMeRouter` gana el hook opcional `beforeDeleteAccount`; `toApiError` suma `OPEN_PAYMENTS_UNAUTHORIZED` (502) y `GRANT_REVOKED` (409).
  - **019 lote 2**: `api-key-auth.ts` suma `GET /dev/passkeys*`.
  - **020**: `api-key-auth.ts`/`json-body.ts` para `/admin/*`; `ids.ts` suma `evt`.
  - El estado `AUTHORIZING` del WalletLink es interno; la API expone `PENDING_AUTHORIZATION`.
- Acción para los demás: no reordenar ni reformatear esos archivos.

### 2026-10-17 · Contratos publicados por 006 y 019 (lote 1) para los demás
- Origen: orquestador
- Afecta: specs 007, 008, 009, 020, 021, 023, 024
- Decisión:
  - 006: `createPaymentRequestsRouter({ service, idempotencyStore })`; `PaymentRequest.amount` es opcional.
  - 019: `userAuth(sessions, users)`, `requireRecentSession`, `getSessionUser(req)` en `src/shared/middlewares/user-auth.ts`; `SessionService` en `src/shared/session/`; `UsersRepository` + `createInMemoryUsersRepository` en `src/modules/users/`; puerto `PasskeyVerifier` (+ fake de tests en `tests/helpers/fake-passkey-verifier.ts`); `createAuthRouter` y `createMeRouter`.
  - Rutas públicas sin API key: solo las listadas en `PUBLIC_ROUTES` de `api-key-auth.ts` (`METHOD path` exacto).
- Acción para los demás: reutilizar estos contratos; no redefinirlos.

### 2026-10-17 · Excepciones: 019 y 020 tocan `api-key-auth.ts` y `ids.ts`
- Origen: orquestador (avisado por los agentes de tests de 019 y 020)
- Afecta: specs 019, 020 (y 006) · `src/shared/middlewares/api-key-auth.ts`, `src/shared/middlewares/json-body.ts`, `src/shared/ids/ids.ts`
- Decisión: excepciones puntuales a "los middlewares del 005 se usan tal cual":
  - **019**: `api-key-auth.ts` deja pasar sin API key los `POST` públicos de `auth` y `GET`/`DELETE /api/v1/me`; `ids.ts` agrega los prefijos `usr` y `chl`.
  - **020**: `api-key-auth.ts` y `json-body.ts` dejan pasar el panel (`/admin/*`) sin API key ni parser JSON; `ids.ts` agrega `evt`.
  - Cada worker hace solo su cambio, mínimo y aditivo (una entrada por lista); no reordena ni reformatea el archivo. El orquestador resuelve el conflicto de merge al integrar.
- Acción para los demás: el 006 no toca esos archivos.

### 2026-10-17 · Dueños de archivos del spec 006
- Origen: orquestador
- Afecta: specs 006, 019, 020
- Decisión: el **006** es dueño de `src/modules/payments/` (servicios, controlador, rutas, lo que agregue) y de `src/shared/qr/` si lo necesita. Sigue sin editar `app.ts`, `server.ts`, `lambda.ts` ni `config/`: exporta `createPaymentsRouter(deps)` y el orquestador lo cablea. Si necesita la sesión del usuario (spec 019, aún sin integrar), recibe un middleware `requireSession` por inyección con un fake en los tests; no importa código del 019.
- Acción para los demás: ninguna.

### 2026-10-17 · Dueños de archivos del lote 019 + 020 y cableado de `createApp`
- Origen: orquestador
- Afecta: specs 019, 020 (y 021, 023 en adelante)
- Decisión:
  - **019:** `src/modules/auth/`, `src/modules/users/`, `src/shared/session/`, `src/shared/webauthn/`.
  - **020:** `src/modules/admin/`, `src/shared/settings/` (extiende `SettingsProvider` sin romper su contrato actual), `src/shared/activity/` (`ActivityLog`).
  - Nadie edita `src/app.ts`, `src/server.ts`, `src/lambda.ts` ni `src/config/env.ts`/`secrets.ts` en este lote: cada módulo exporta `createXRouter(deps)` y el orquestador los cablea al integrar. Si hace falta una variable de entorno o un secreto nuevo, va a PROPUESTAS.md.
  - `src/shared/errors/*`, `src/shared/middlewares/*` y `src/shared/idempotency/*` (spec 005, ya Hecho): se usan tal cual; los errores nuevos son `AppError` dentro del módulo de cada spec.
  - Dependencias nuevas las agrega el orquestador en la rama del spec antes de lanzar el worker.
- Acción para los demás: ninguna.

### 2026-10-17 · Dueños de archivos del lote del spec 005 y puerto de idempotencia
- Origen: orquestador
- Afecta: specs 002, 003, 005 (y 006 en adelante)
- Decisión:
  - `src/app.ts`, `src/server.ts`, `src/lambda.ts`, `src/shared/middlewares/`, `src/shared/logger.ts`, `src/shared/validation/`, `src/shared/idempotency/` y `src/shared/errors/*`: solo el **005**. El 005 puede agregar `details` opcional a `errorBody` y mapear los errores de `express.json` (413/415) en `errorHandler`.
  - `src/config/env.ts` sigue siendo solo del 003: `CORS_ALLOWED_ORIGINS` se lee con `process.env` en `server.ts`/`lambda.ts` y entra a `createApp` como `corsAllowedOrigins: string[]` (por defecto `[]`).
  - Idempotencia: puerto `IdempotencyStore` (`begin` / `complete` / `release`) con implementación en memoria; la de DynamoDB llega con el primer spec que use el middleware (006).
  - El 005 agrega `helmet`, `cors` y `pino-http` (las dependencias las agrega el orquestador).
- Acción para los demás: el 003 y el 002 no tocan esos archivos; si necesitan algo, PROPUESTAS.md.

### 2026-10-16 · Autopagos y paginación con direction=all
- Origen: spec 004 (worker)
- Afecta: specs 004, 007, 008
- Decisión: un pago con emisor = receptor podría repetirse entre páginas de
  `listByWallet` con `direction: 'all'` en DynamoDB (aparece en ambos índices). Se
  acepta por ahora; el 007 debe rechazar pagos a la propia wallet.
- Acción para los demás: el 007 valida emisor ≠ receptor.

### 2026-10-16 · Formato del secreto `token-encryption-key` (CONFIRMADO 2026-10-17)
- Origen: spec 002 (orquestador)
- Afecta: specs 002, 023 · `backend/infra/lib/backend-stack.ts`, cifrado de tokens
- Decisión: Secrets Manager solo genera cadenas aleatorias de caracteres, no 32 bytes
  en base64. La plantilla genera **64 caracteres alfanuméricos** y el spec 023 deriva
  la llave AES-256 con `SHA-256(secreto)` (32 bytes). En local, `TOKEN_ENCRYPTION_KEY`
  sigue la misma regla.
- Confirmado por el responsable el 2026-10-17 (opción más simple: no cambia la plantilla).
- Acción para los demás: el 023 implementa la derivación.

### 2026-10-16 · Configuración opcional de la Lambda
- Origen: spec 002 (orquestador)
- Afecta: specs 002, 003, 019, 020, 023, 024
- Decisión: las variables con valor por defecto en el backend (`WEBAUTHN_RP_ID`,
  `WEBAUTHN_ORIGINS`, `WALLET_PROVIDER_BASE_URL`, `DAILY_SPEND_LIMITS`,
  `DAILY_LIMIT_TIMEZONE`, `FEE_PERCENTAGE`, `ALLOWED_WALLET_HOSTS`,
  `FRONTEND_RESULT_URL`) solo se pasan a la Lambda si se definen en las propiedades
  del stack; el backend aplica sus defaults de API.md. `ADMIN_ENABLED` siempre se
  pasa: `true` en `dev`, `false` en otros stages, salvo que la propiedad lo cambie.
- Acción para los demás: al desplegar en `dev` hay que definir `webauthnRpId` y
  `webauthnOrigins` (dominio de CloudFront, decisión 6 del spec 019).

### 2026-10-16 · Acceso de la Lambda a los índices de DynamoDB
- Origen: spec 002 (propuesta del worker, aceptada por el orquestador)
- Afecta: specs 002, 004, 008 · `backend/infra/lib/backend-stack.ts`
- Decisión: la Lambda tiene lectura/escritura sobre la tabla de pagos **y** sus
  índices (`tableArn` y `tableArn/index/*`) con `grantReadWriteData`. El test del
  caso 5 se corrigió para exigir exactamente esos dos recursos.
- Acción para los demás: el 004 puede hacer `Query` sobre `bySender` y `byReceiver`.

### 2026-10-16 · Idioma del código
- Origen: orquestador
- Afecta: todos los specs · `backend/src/`, `backend/infra/lib/`
- Decisión: comentarios, mensajes de error y nombres en **inglés**, como el código
  existente. Los nombres de los tests (`it(...)`) siguen en español.
- Acción para los demás: aplicarlo desde ya.

### 2026-10-16 · Contenedores locales con Colima + nerdctl (sin Docker)
- Origen: responsable / orquestador
- Afecta: spec 004 (tareas 5–6) y cualquier test con contenedores
- Decisión: no hay Docker; se usa Colima (runtime containerd) con `nerdctl`. Los
  puertos publicados con `-p` **no** llegan a macOS: el contenedor debe correr con
  `--network host`. `-d` y `--rm` no se pueden combinar. DynamoDB Local:
  `nerdctl run -d --name tranqui-dynamodb --network host amazon/dynamodb-local:2.6.1 -jar DynamoDBLocal.jar -inMemory -sharedDb -port 8000`
  → `http://localhost:8000`. Si Colima no arranca con "disk in use", el disco quedó
  bloqueado: `LIMA_HOME=~/.colima/_lima limactl disk unlock colima` (solo si no hay VM corriendo).
- Acción para los demás: los workers no pueden correr `nerdctl`; el orquestador
  levanta DynamoDB Local antes de lanzar el lote y el worker corre `pnpm test:dynamo`.

### 2026-10-16 · Cursor de paginación inválido
- Origen: spec 004 (orquestador)
- Afecta: specs 004, 008
- Decisión: el repositorio en memoria hoy lanza un error de JSON si el cursor está
  corrupto. El endpoint del 008 debe validar el cursor y responder
  `400 VALIDATION_ERROR` (o el repositorio lanzar un error propio); se define en el 008.
- Acción para los demás: ninguna en este lote.

### 2026-10-16 · Logs que alimentan las alarmas
- Origen: spec 002 (orquestador)
- Afecta: specs 002, 005, 023 · `backend/infra/lib/backend-stack.ts`, logs de la app
- Decisión: las alarmas de `401` y `CALLBACK_INVALID` leen los logs JSON de la
  Lambda con estos filtros: `{ $.statusCode = 401 }` y
  `{ $.errorCode = "CALLBACK_INVALID" }`. Quien registre las respuestas (spec 005)
  debe escribir los campos `statusCode` y `errorCode` en el nivel raíz del log.
- Acción para los demás: ninguna en este lote; el 005 lo implementa.

### 2026-10-16 · Fechas y TTL en las entidades de pagos
- Origen: spec 004 (orquestador)
- Afecta: specs 004, 006–009 · `src/modules/payments/`
- Decisión: las fechas del dominio (`createdAt`, `updatedAt`, `quote.expiresAt`,
  `expiresAt` de una solicitud) son strings ISO 8601 en UTC. El TTL de un pago
  pendiente es `expiresAt?: number` en **segundos epoch** (lo que espera DynamoDB).
- Acción para los demás: ninguna.

### 2026-10-16 · Variables de entorno: nombres y formatos (código ↔ IaC)
- Origen: specs 002 y 003 (orquestador)
- Afecta: specs 002, 003 · `src/config/env.ts`, `backend/infra/lib/backend-stack.ts`
- Decisión: nombres exactos y formatos, iguales en el código y en la plantilla:
  - `OPEN_PAYMENTS_TIMEOUT_MS`: entero positivo en ms (por defecto `8000`).
  - `WALLET_PROVIDER_BASE_URL`: URL `https` sin `/` final (por defecto `https://ilp.interledger-test.dev`).
  - `ALLOWED_WALLET_HOSTS`: hosts separados por coma, sin esquema (por defecto vacío).
  - `MAX_PAYMENT_AMOUNTS`: `CODIGO:monto` separados por coma, p. ej. `USD:1000,MXN:20000` (por defecto `USD:1000`).
  - `PAYMENTS_TABLE_NAME`: nombre de la tabla DynamoDB (solo Lambda; reemplaza a `GRANTS_TABLE_NAME`).
- Acción para los demás: el 002 pasa estas variables a la Lambda; el 003 las lee en `loadConfig`.

### 2026-10-16 · Dueños de archivos compartidos en este lote
- Origen: orquestador
- Afecta: specs 002, 003, 004
- Decisión:
  - `src/config/env.ts` y `src/config/secrets.ts`: solo el **003**.
  - `src/shared/errors/*`: nadie los modifica en este lote. Los errores nuevos se
    crean como `AppError` (o subclases) dentro del módulo de cada spec.
  - `src/modules/payments/` y `src/shared/ids/`: solo el **004**.
  - `src/integrations/open-payments/`, `src/shared/money/`, `src/shared/security/`
    y `src/shared/settings/`: solo el **003**.
  - `backend/infra/`: solo el **002**. El 002 no toca `backend/src/`.
- Acción para los demás: si necesitas tocar un archivo de otro spec, escríbelo en PROPUESTAS.md.

### 2026-10-16 · Tipos de montos compartidos
- Origen: orquestador
- Afecta: specs 003, 004 (y los siguientes) · `src/shared/money/types.ts`
- Decisión: `Amount = { value: string; assetCode: string }` (decimal en string) y
  `FixedAmountSide = 'receive' | 'send'` viven en `src/shared/money/types.ts`, ya
  en la rama base. Se importan desde ahí; no se redefinen ni se modifican.
- Acción para los demás: usarlos tal cual.

### 2026-10-16 · Dependencias
- Origen: orquestador
- Afecta: todos
- Decisión: los workers no agregan dependencias. En este lote no se necesitan:
  los IDs ULID se generan con `node:crypto`. El SDK de Open Payments (7.4.0) y msw
  (3.0.3) ya los agregó el orquestador en `spec/003` (2026-10-17).
- Acción para los demás: ninguna.
