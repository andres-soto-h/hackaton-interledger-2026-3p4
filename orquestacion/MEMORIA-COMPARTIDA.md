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
| 002 | `spec/002` | `../<repo>-worktrees/spec-002` | 2026-10-16 | Tareas 13–16 (índices, throttling, configuración, alarmas) |
| 003 | `spec/003` | `../<repo>-worktrees/spec-003` | 2026-10-16 | Tareas 1–5 (configuración, montos, anti-SSRF, puerto + fake, errores) |
| 004 | `spec/004` | `../<repo>-worktrees/spec-004` | 2026-10-16 | Tareas 1–4 (tipos, IDs, puerto + contrato, memoria) |

## Decisiones

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
