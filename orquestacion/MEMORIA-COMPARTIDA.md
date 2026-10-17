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
| 003 | `spec/003` | `../<repo>-worktrees/spec-003` | 2026-10-16 | Tareas 1–5 (configuración, montos, anti-SSRF, puerto + fake, errores) |
| 004 | `spec/004` | `../<repo>-worktrees/spec-004` | 2026-10-16 | Tareas 5–6 (DynamoDB + `pnpm test:dynamo`) |

## Decisiones

### 2026-10-16 · Autopagos y paginación con direction=all
- Origen: spec 004 (worker)
- Afecta: specs 004, 007, 008
- Decisión: un pago con emisor = receptor podría repetirse entre páginas de
  `listByWallet` con `direction: 'all'` en DynamoDB (aparece en ambos índices). Se
  acepta por ahora; el 007 debe rechazar pagos a la propia wallet.
- Acción para los demás: el 007 valida emisor ≠ receptor.

### 2026-10-16 · Formato del secreto `token-encryption-key` (PENDIENTE de confirmar por el responsable)
- Origen: spec 002 (orquestador)
- Afecta: specs 002, 023 · `backend/infra/lib/backend-stack.ts`, cifrado de tokens
- Decisión: Secrets Manager solo genera cadenas aleatorias de caracteres, no 32 bytes
  en base64. La plantilla genera **64 caracteres alfanuméricos** y el spec 023 deriva
  la llave AES-256 con `SHA-256(secreto)` (32 bytes). En local, `TOKEN_ENCRYPTION_KEY`
  sigue la misma regla.
- Acción para los demás: el 023 implementa la derivación; si el responsable prefiere
  otra opción, se marca *Reemplazada*.

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
  los IDs ULID se generan con `node:crypto`. El SDK de Open Payments y msw los
  agrega el orquestador en el lote del adapter (003, tareas 6–7).
- Acción para los demás: ninguna.
