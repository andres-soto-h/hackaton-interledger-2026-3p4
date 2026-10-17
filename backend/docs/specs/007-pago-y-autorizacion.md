# 007 — Hacer pago y autorización interactiva

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec en borrador, pendiente de aprobación. Depende de los specs 003, 004 y 005.

## Contexto

Es el corazón de la API. Un pago necesita que el dueño de la wallet emisora lo
apruebe en su proveedor (grant interactivo), así que se divide en dos pasos:
`POST /payments` prepara el pago y devuelve una URL de autorización, y
`GET /auth/callback` recibe la aprobación y ejecuta el pago. Flujo y estados en
[API.md](../API.md#hacer-pago).

## Alcance

**Incluye**
- `POST /api/v1/payments`.
- `GET /api/v1/auth/callback` (público) con todas las validaciones del flujo interactivo.
- Página HTML provisional de resultado mientras no existe el frontend.
- Configuración: `API_BASE_URL`, `FRONTEND_RESULT_URL`, `PAYMENT_AUTH_TTL_SECONDS`.

**No incluye**
- Consultar el estado (spec 008) ni avisar al agente (spec 009).
- Pagos recurrentes, reembolsos, cancelaciones.

## Criterios de aceptación

- **Dado** un emisor y un receptor válidos, **cuando** se inicia el pago,
  **entonces** responde `202` con el quote (ambos montos y la tasa) y la URL de
  autorización, y el pago queda en `PENDING_AUTHORIZATION`.
- **Dado** un `incomingPaymentUrl`, **cuando** se inicia el pago, **entonces** no
  se crea otro incoming payment.
- **Dado** que el emisor aprueba, **cuando** llega el callback válido,
  **entonces** se crea el outgoing payment, el pago pasa a `PROCESSING` y el
  usuario ve la página de resultado.
- **Dado** un callback con hash alterado, repetido, vencido o de un pago
  inexistente, **cuando** llega, **entonces** no se ejecuta ningún pago.
- **Dado** que el emisor rechaza, **cuando** llega el callback, **entonces** el
  pago pasa a `REJECTED`.

## Diseño

### `POST /api/v1/payments`

Request (variantes excluyentes):

```json
{
  "type": "p2p",
  "senderWalletAddress": "https://ilp.interledger-test.dev/alice",
  "receiverWalletAddress": "https://ilp.interledger-test.dev/bob",
  "amount": { "value": "25.00", "assetCode": "USD" },
  "description": "Almuerzo"
}
```
```json
{
  "type": "p2m",
  "senderWalletAddress": "https://ilp.interledger-test.dev/alice",
  "incomingPaymentUrl": "https://ilp.interledger-test.dev/incoming-payments/..."
}
```

- Con `receiverWalletAddress`: `amount` obligatorio. Qué monto queda fijo
  depende de su moneda ([API.md — monedas](../API.md#pagos-entre-monedas-distintas)).
- Con `incomingPaymentUrl`: `amount` solo si el incoming payment no tiene monto.
- `Idempotency-Key` recomendado.

Response `202`:

```json
{
  "paymentId": "pay_01J...",
  "status": "PENDING_AUTHORIZATION",
  "authorizationUrl": "https://auth.interledger-test.dev/interact/...",
  "authorizationExpiresAt": "2026-10-16T21:05:00.000Z",
  "quote": {
    "debitAmount": { "value": "25.07", "assetCode": "USD" },
    "receiveAmount": { "value": "430.00", "assetCode": "MXN" },
    "exchangeRate": "17.152",
    "expiresAt": "2026-10-16T21:05:00.000Z"
  }
}
```

`PaymentsService.initiate`:
1. Validar URLs (anti-SSRF) y obtener wallets.
2. Resolver el incoming payment: crearlo o validar el recibido (no completado,
   no vencido, con monto o con `amount`) → si no: `INCOMING_PAYMENT_NOT_PAYABLE`.
3. Crear el quote; aplicar `MAX_PAYMENT_AMOUNTS` al `debitAmount`.
4. Generar `paymentId` y `clientNonce` (aleatorio criptográfico).
5. Pedir el grant interactivo con límite = `quote.debitAmount`, `identifier` =
   wallet del emisor y `finish.uri = {API_BASE_URL}/api/v1/auth/callback?paymentId=<id>`.
6. Guardar el pago con los datos de autorización y TTL =
   `min(quote.expiresAt, ahora + PAYMENT_AUTH_TTL_SECONDS)`.

### `GET /api/v1/auth/callback`

Query: `paymentId` (lo pone la API en el `finish.uri`) más `interact_ref` y
`hash`, o `result=grant_rejected` (los agrega el authorization server).

`AuthorizationService.handleCallback`, en este orden:

| # | Validación | Si falla |
|---|---|---|
| 1 | El pago existe | `PAYMENT_NOT_FOUND` |
| 2 | Está en `PENDING_AUTHORIZATION` | `CALLBACK_ALREADY_USED` |
| 3 | No venció el TTL ni el quote | Pago → `EXPIRED`; `AUTHORIZATION_EXPIRED` |
| 4 | Si `result=grant_rejected` | Pago → `REJECTED` |
| 5 | Vienen `interact_ref` y `hash` | `CALLBACK_INVALID` |
| 6 | `hash` = `base64(sha256(clientNonce + "\n" + finishNonce + "\n" + interact_ref + "\n" + authServerUrl))`, comparado en tiempo constante ([docs](https://openpayments.dev/identity/hash-verification/)) | `CALLBACK_INVALID`; el pago no cambia |
| 7 | Tomar el pago con actualización condicional (un solo uso) | `CALLBACK_ALREADY_USED` |
| 8 | Continuar el grant (si responde `wait`, esperar y reintentar una vez) y verificar que esté finalizado | `GRANT_NOT_FINALIZED` → `FAILED` |
| 9 | El límite concedido cubre `quote.debitAmount` | `GRANT_LIMITS_MISMATCH` → `FAILED` |
| 10 | Crear el outgoing payment con `quoteId` | Error mapeado → `FAILED` |
| — | Éxito | Pago → `PROCESSING` |

### Respuesta del callback

- Siempre una redirección o una página, nunca JSON (quien llega es el navegador).
- Con `FRONTEND_RESULT_URL`: `302` a `FRONTEND_RESULT_URL?paymentId=…&status=…[&error=…]`.
- Sin `FRONTEND_RESULT_URL`: página HTML provisional que muestra el estado, el
  monto y el mensaje de error si lo hay. Sin datos sensibles; con CSP estricta.
- Nunca se redirige a una URL recibida en la petición.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Pago P2P con receptor por wallet | `202`; quote, `authorizationUrl`; pago `PENDING_AUTHORIZATION` guardado con nonces y TTL |
| 2 | Integration | Pago con `incomingPaymentUrl` | `202`; no crea incoming payment |
| 3 | Integration | Incoming payment completado / vencido / sin monto y sin `amount` | `422 INCOMING_PAYMENT_NOT_PAYABLE` |
| 4 | Integration | Pago entre monedas distintas (emisor USD, receptor MXN) | Quote con ambos montos y `exchangeRate` |
| 5 | Integration | Quote falla | `422 QUOTE_FAILED`; nada guardado |
| 6 | Integration | `debitAmount` sobre el límite | `422 AMOUNT_EXCEEDS_LIMIT`; no se pide grant |
| 7 | Integration | Parámetros del grant interactivo | Límite, `identifier`, `finish.uri` desde `API_BASE_URL` y nonce exactos |
| 8 | Integration | Callback válido | Grant continuado, outgoing payment creado, `PROCESSING` |
| 9 | Integration | Callback con hash alterado | `CALLBACK_INVALID`; no continúa el grant; pago sin cambios |
| 10 | Integration | Callback repetido / dos en paralelo | Uno solo crea el outgoing payment; el otro `CALLBACK_ALREADY_USED` |
| 11 | Integration | `result=grant_rejected` | `REJECTED` |
| 12 | Integration | Callback vencido (TTL o quote) | `EXPIRED` |
| 13 | Integration | `paymentId` inexistente | `PAYMENT_NOT_FOUND`; sin llamadas al gateway |
| 14 | Integration | Grant no finalizado / límite menor | `FAILED` con `GRANT_NOT_FINALIZED` / `GRANT_LIMITS_MISMATCH` |
| 15 | Integration | Falla la creación del outgoing payment | `FAILED`; error mapeado |
| 16 | Integration | Con `FRONTEND_RESULT_URL` / sin ella | `302` a la URL configurada / HTML provisional |
| 17 | Integration | Query con un parámetro de URL de redirección | Se ignora; sin open redirect |
| 18 | Unit | Cálculo del hash con un vector conocido | Hash esperado |
| 19 | Integration | `POST /payments` en el test de rutas protegidas; callback accesible sin API key | `401` / accesible |

## Tareas

1. [ ] Configuración nueva y verificación del hash (caso 18).
2. [ ] `PaymentsService.initiate`: casos 1–7 en rojo → implementación.
3. [ ] Ruta y controller `POST /payments` con idempotencia.
4. [ ] `AuthorizationService.handleCallback`: casos 8–15 en rojo → implementación.
5. [ ] Ruta del callback, redirección y HTML provisional: casos 16–17 y 19.
6. [ ] Contrato en `openapi.yaml`.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Montos | Decimales en string (`"25.00"`) |
| 2 | Resultado para el usuario | HTML provisional hasta que exista el frontend |

## Decisiones pendientes

1. **`API_BASE_URL` en Lambda.** Pasar la URL de API Gateway a la propia Lambda
   crea una dependencia circular en CloudFormation. Recomendación: tomarla del
   `requestContext.domainName` que pone API Gateway (no del header `Host` del
   cliente); en local, de la variable. Alternativa: dominio propio fijo.
