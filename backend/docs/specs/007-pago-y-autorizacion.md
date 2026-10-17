# 007 — Hacer pago con el monto diario preaprobado

| Campo | Valor |
|---|---|
| Estado | **Hecho** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 (versión con aprobación en la wallet por pago); cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | 2026-10-17 |

## Estado

9 / 9 tareas completadas e integradas en `develop-andres` (932 tests, más 101 contra DynamoDB Local, typecheck y lint en verde). Router y servicio cableados en la composición con comisión cero hasta el spec 024; contrato en `openapi.yaml`. Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar todos los specs hasta el 024); rama `spec/007`. Reescrito el 2026-10-16 por la decisión de aprobar los
pagos una sola vez, con un monto diario (spec 023). Cambios aprobados el 2026-10-16. Depende de los specs 003, 004, 005, 019 y 023.

**Qué cambió respecto a la versión aprobada:**
- Ya no hay grant interactivo por pago ni `authorizationUrl`: el pago usa el
  token de la vinculación de la wallet (spec 023).
- El callback y sus validaciones se movieron al spec 023.
- El pago tiene dos pasos dentro de la app: **cotizar** y **confirmar con el
  passkey** del usuario. La confirmación reemplaza la aprobación en la wallet.
- Requiere sesión de usuario; la API key ya no puede crear pagos.
- Estados nuevos: `AWAITING_CONFIRMATION` y `CANCELLED`; desaparecen
  `PENDING_AUTHORIZATION` y `REJECTED`.
- La cotización incluye la comisión (spec 024) y el disponible del día.

## Contexto

El usuario ya aprobó en su wallet un monto diario al vincularla (spec 023). Para
pagar, la app cotiza, le muestra al usuario cuánto sale, cuánto llega, la
comisión y cuánto le queda del día, y el usuario confirma en la app. Al
confirmar, la API crea el outgoing payment con el token guardado, sin salir de
la app.

**Por qué la API key ya no puede pagar:** con un permiso preaprobado, quien
pueda crear pagos puede gastar el monto diario de cualquier usuario. Por eso
crear y confirmar pagos exige la sesión del propio usuario (spec 019), y el
emisor es siempre la wallet vinculada de esa sesión, nunca un dato del body.

## Alcance

**Incluye**
- `POST /api/v1/payments` (cotizar), `POST /api/v1/payments/{id}/confirm/options`,
  `POST /api/v1/payments/{id}/confirm` (con passkey) y
  `POST /api/v1/payments/{id}/cancel`.
- Reserva y liberación del monto diario (spec 023).
- Interruptor `paymentsEnabled` (spec 020).

**No incluye**
- Vincular la wallet ni el callback (spec 023).
- Cobro de la comisión (spec 024; aquí solo se integra su cálculo y su llamada).
- Consultar el estado (spec 008) ni el contrato de polling (spec 009).

## Criterios de aceptación

- **Dado** un usuario con wallet vinculada, **cuando** cotiza un pago válido,
  **entonces** responde `201` con ambos montos, la tasa, la comisión, el total y
  el disponible del día, y el pago queda `AWAITING_CONFIRMATION` hasta que vence
  el quote.
- **Dado** un usuario sin vinculación `ACTIVE`, **cuando** cotiza, **entonces**
  responde `403 WALLET_NOT_LINKED`.
- **Dado** un pago en `AWAITING_CONFIRMATION` del propio usuario, **cuando** lo
  confirma con su passkey antes de que venza el quote, **entonces** se reserva el
  total, se crea el outgoing payment y el pago pasa a `PROCESSING`.
- **Dado** una confirmación sin passkey, con un passkey de otro usuario o con un
  desafío emitido para otro pago, **cuando** llega, **entonces** se rechaza y no
  se mueve dinero.
- **Dado** un pago de otro usuario, **cuando** se intenta confirmar o consultar,
  **entonces** responde `404 PAYMENT_NOT_FOUND` (no revela que existe).
- **Dado** un total que supera el disponible del día, **cuando** se cotiza o se
  confirma, **entonces** responde `422 DAILY_LIMIT_EXCEEDED` sin mover dinero.
- **Dado** dos confirmaciones del mismo pago, **cuando** llegan, **entonces**
  solo una crea el outgoing payment.
- **Dado** un quote vencido, **cuando** se confirma, **entonces** el pago pasa a
  `EXPIRED` y responde `410 QUOTE_EXPIRED`.
- **Dado** que falla la creación del outgoing payment, **cuando** ocurre,
  **entonces** el pago pasa a `FAILED` y se libera la reserva.

## Diseño

### Flujo

```
App ──POST /payments──▶ API                      (sesión)
                         ├─ vinculación ACTIVE del usuario (emisor = su wallet)
                         ├─ resolver receptor / incoming payment
                         ├─ quote (wallet del emisor) + límite por pago
                         ├─ comisión (spec 024) y disponible del día (sin reservar)
                         └─ Payment AWAITING_CONFIRMATION (vence con el quote)
App ◀── 201 { paymentId, quote, allowance, confirmBy } ─┘

Usuario revisa y confirma con su passkey (huella o PIN del dispositivo)
App ──POST /payments/{id}/confirm/options──▶ API  → desafío ligado al pago
App ──POST /payments/{id}/confirm──▶ API         (sesión + firma del passkey)
                         ├─ verifica el passkey (spec 019)
                         ├─ toma el pago con actualización condicional (un solo uso)
                         ├─ reserva totalDebit en el monto diario
                         ├─ token de la vinculación (rota si hace falta)
                         ├─ crea el outgoing payment con quoteId
                         ├─ cobra la comisión (spec 024)
                         └─ Payment → PROCESSING
App ◀── 202 { paymentId, status: PROCESSING } + Retry-After ─┘

App ──GET /payments/{id}──▶ hasta COMPLETED / FAILED (specs 008 y 009)
```

### `POST /api/v1/payments`

Request (variantes excluyentes; el emisor sale de la sesión):

```json
{ "type": "p2p", "receiverWalletAddress": "https://ilp.interledger-test.dev/bob",
  "amount": { "value": "25.00", "assetCode": "USD" }, "description": "Almuerzo" }
```
```json
{ "type": "p2m", "incomingPaymentUrl": "https://ilp.interledger-test.dev/incoming-payments/..." }
```

- Con `receiverWalletAddress`: `amount` obligatorio; qué monto queda fijo según
  [Soporte de distintas monedas](003-integracion-open-payments.md#soporte-de-distintas-monedas).
- Con `incomingPaymentUrl`: `amount` solo si el incoming payment no tiene monto.
- `Idempotency-Key` recomendado.

Response `201`:

```json
{
  "paymentId": "pay_01J...",
  "status": "AWAITING_CONFIRMATION",
  "confirmBy": "2026-10-16T21:05:00.000Z",
  "quote": {
    "debitAmount": { "value": "25.07", "assetCode": "USD" },
    "receiveAmount": { "value": "430.00", "assetCode": "MXN" },
    "exchangeRate": "17.152",
    "fee": { "value": "0.38", "assetCode": "USD", "percentage": "1.5" },
    "totalDebit": { "value": "25.45", "assetCode": "USD" }
  },
  "allowance": { "dailyLimit": { "value": "200.00", "assetCode": "USD" },
                 "availableAfter": { "value": "134.55", "assetCode": "USD" } }
}
```

`PaymentsService.quote`:
1. `paymentsEnabled` (si no, `503 PAYMENTS_DISABLED`).
2. Vinculación `ACTIVE` del usuario → emisor.
3. Validar URLs (anti-SSRF) y resolver el incoming payment: crearlo o validar el
   recibido → si no se puede pagar, `INCOMING_PAYMENT_NOT_PAYABLE`.
4. Quote; `MAX_PAYMENT_AMOUNTS` al `debitAmount`.
5. Comisión y total (spec 024); verificar el disponible sin reservar.
6. Guardar el pago con `expiresAt = quote.expiresAt`.

### Confirmación con passkey

`POST /api/v1/payments/{id}/confirm/options` (sesión): si el pago es del
usuario y está en `AWAITING_CONFIRMATION`, devuelve opciones de WebAuthn
(`allowCredentials` = passkeys del usuario, `userVerification: required`) y un
`challengeId`. El desafío se guarda con tipo `payment_confirmation`, el
`paymentId`, el `userId` y el `totalDebit`, con TTL de 2 minutos (nunca más que
el vencimiento del quote) y de un solo uso.

### `POST /api/v1/payments/{id}/confirm`

Body: `{ challengeId, credential }`.

| # | Paso | Si falla |
|---|---|---|
| 1 | El pago existe y es del usuario de la sesión | `404 PAYMENT_NOT_FOUND` |
| 2 | El desafío existe, no venció, es de tipo `payment_confirmation`, del mismo pago y usuario, y se consume (un solo uso) | `400 CHALLENGE_EXPIRED` |
| 3 | La firma del passkey es válida y el passkey es del usuario (spec 019) | `400 PASSKEY_VERIFICATION_FAILED`; el pago no cambia |
| 4 | Está en `AWAITING_CONFIRMATION` y se toma con actualización condicional | `409 PAYMENT_NOT_CONFIRMABLE` |
| 5 | El quote no venció | → `EXPIRED`; `410 QUOTE_EXPIRED` |
| 6 | Reservar `totalDebit` (spec 023) | → vuelve a `AWAITING_CONFIRMATION`; `422 DAILY_LIMIT_EXCEEDED` |
| 7 | Obtener el token de la vinculación (rotando si hace falta) | `WALLET_LINK_REVOKED` → `FAILED`, reserva liberada |
| 8 | Crear el outgoing payment con `quoteId` | Error mapeado → `FAILED`, reserva liberada |
| 9 | Cobrar la comisión (spec 024) | No afecta al pago principal |
| — | Éxito | → `PROCESSING`; `202` con `Retry-After: 2` |

`Idempotency-Key` recomendado; aunque falte, la actualización condicional del
paso 4 impide un doble pago.

**Por qué con passkey:** con un permiso preaprobado, la sesión sola bastaría
para gastar el monto diario. La firma del passkey exige que el usuario esté
presente y desbloquee su dispositivo, así que ni el agente ni alguien con la
sesión robada pueden confirmar un pago.

### `POST /api/v1/payments/{id}/cancel`

Solo en `AWAITING_CONFIRMATION` → `CANCELLED` (`204`). No hay reserva que liberar.

### Estados

```
AWAITING_CONFIRMATION ──confirmar──▶ PROCESSING ──▶ COMPLETED
        │                                 └───────▶ FAILED
        ├──cancelar──────▶ CANCELLED
        └──quote vencido─▶ EXPIRED
```

`COMPLETED`, `FAILED`, `CANCELLED` y `EXPIRED` son finales.

### Errores nuevos o que cambian

| Código | HTTP | Cuándo |
|---|---|---|
| `WALLET_NOT_LINKED` | 403 | Sin vinculación `ACTIVE` (spec 023) |
| `PAYMENT_NOT_CONFIRMABLE` | 409 | El pago no está esperando confirmación |
| `QUOTE_EXPIRED` | 410 | Se confirmó después de vencer el quote |
| `DAILY_LIMIT_EXCEEDED` | 422 | Spec 023 |

Salen de este spec (pasan al 023): `CALLBACK_INVALID`, `CALLBACK_ALREADY_USED`,
`AUTHORIZATION_EXPIRED`, `GRANT_NOT_FINALIZED`, `GRANT_LIMITS_MISMATCH`.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Cotizar P2P con receptor por wallet | `201`; quote, comisión, total y disponible; `AWAITING_CONFIRMATION` con vencimiento del quote |
| 2 | Integration | Cotizar con `incomingPaymentUrl` | No crea incoming payment |
| 3 | Integration | Incoming payment completado / vencido / sin monto y sin `amount` | `422 INCOMING_PAYMENT_NOT_PAYABLE` |
| 4 | Integration | Emisor USD, receptor MXN | Ambos montos y `exchangeRate` |
| 5 | Integration | Sin sesión / con API key / sin vinculación activa | `401` / `401` / `403 WALLET_NOT_LINKED` |
| 6 | Integration | `senderWalletAddress` en el body | `400 VALIDATION_ERROR` (el emisor sale de la sesión) |
| 7 | Integration | Quote falla / `debitAmount` sobre el límite por pago | `422 QUOTE_FAILED` / `422 AMOUNT_EXCEEDS_LIMIT`; nada guardado |
| 8 | Integration | Total sobre el disponible al cotizar / al confirmar | `422 DAILY_LIMIT_EXCEEDED`; sin reserva ni outgoing payment |
| 9 | Integration | Confirmar válido (opciones + firma del passkey) | Reserva del total, outgoing payment con `quoteId` y token de la vinculación, `PROCESSING` |
| 10 | Integration | Confirmar un pago de otro usuario | `404 PAYMENT_NOT_FOUND` |
| 11 | Integration | Dos confirmaciones en paralelo | Un solo outgoing payment; la otra `409 PAYMENT_NOT_CONFIRMABLE` |
| 12 | Integration | Confirmar con quote vencido | `EXPIRED`; `410 QUOTE_EXPIRED` |
| 13 | Integration | Falla el outgoing payment / vinculación revocada | `FAILED`; reserva liberada |
| 14 | Integration | Cancelar en `AWAITING_CONFIRMATION` / en otro estado | `204 CANCELLED` / `409` |
| 15 | Integration | `paymentsEnabled = false` | `503 PAYMENTS_DISABLED` |
| 16 | Integration | Rutas exigen sesión (test de rutas protegidas) | `401` sin sesión |
| 17 | Integration | Confirmar sin `credential` / firma inválida / passkey de otro usuario | `400`; el pago sigue `AWAITING_CONFIRMATION`; sin reserva |
| 18 | Integration | Desafío de otro pago / ya usado / vencido / de tipo `login` | `400 CHALLENGE_EXPIRED`; sin movimiento de dinero |
| 19 | Integration | Opciones de confirmación de un pago ajeno o no confirmable | `404` / `409` |

## Tareas

1. [x] `PaymentsService.quote`: casos 1–8 y 15 en rojo → implementación.
2. [x] Ruta y controller `POST /payments` con idempotencia.
3. [x] Desafío de confirmación ligado al pago: casos 18–19 en rojo → implementación.
4. [x] `PaymentsService.confirm` con verificación del passkey: casos 9–13 y 17 en rojo → implementación.
5. [x] Rutas de opciones y confirmación con idempotencia.
6. [x] Cancelar: caso 14.
7. [x] Rutas protegidas por sesión (caso 16).
8. [x] Contrato en `openapi.yaml`.
9. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Montos | Decimales en string (`"25.00"`) |
| 2 | Aprobación | Una vez al vincular la wallet, con monto diario (spec 023, 2026-10-16) |
| 3 | Confirmación de cada pago | Con el passkey del usuario (2026-10-16) |

## Decisiones pendientes

Ninguna.
