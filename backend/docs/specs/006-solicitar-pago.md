# 006 — Solicitar pago

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 5 tareas completadas. Spec en borrador, pendiente de aprobación. Depende de los specs 003, 004 y 005.

## Contexto

Un comercio (P2M) o una persona (P2P) pide que le paguen. La API crea un
*incoming payment* en la wallet del receptor y devuelve su URL como "link de
cobro"; el pagador la usa en `POST /payments` (spec 007). Flujo en
[API.md](../API.md#solicitar-pago).

## Alcance

**Incluye**
- `POST /api/v1/payment-requests` con su schema, servicio, controller y contrato OpenAPI.

**No incluye**
- Pagar la solicitud (spec 007) ni consultarla (spec 008).
- Cancelar o completar manualmente una solicitud.

## Criterios de aceptación

- **Dado** una wallet receptora permitida y un monto en su moneda, **cuando** se
  solicita el pago, **entonces** se crea el incoming payment con el monto en
  unidad mínima, se guarda la solicitud y responde `201`.
- **Dado** una solicitud sin monto, **cuando** se crea, **entonces** el incoming
  payment no tiene monto (el pagador lo define).
- **Dado** un `assetCode` distinto al de la wallet receptora, **cuando** se
  solicita, **entonces** responde `422 ASSET_MISMATCH` sin crear nada.
- **Dado** una wallet inexistente o no permitida, **cuando** se solicita,
  **entonces** responde `422 WALLET_NOT_FOUND` o `WALLET_NOT_ALLOWED`.

## Diseño

### Request

```json
{
  "type": "p2m",
  "receiverWalletAddress": "https://ilp.interledger-test.dev/comercio-cafe",
  "amount": { "value": "10.50", "assetCode": "USD" },
  "description": "Café y pan",
  "expiresInSeconds": 900
}
```

| Campo | Regla |
|---|---|
| `type` | `p2p` o `p2m` |
| `receiverWalletAddress` | Obligatorio |
| `amount` | Opcional; moneda = la de la wallet receptora |
| `description` | Opcional, máx. 140 |
| `expiresInSeconds` | Opcional, 60–86400, por defecto 900 |
| Header `Idempotency-Key` | Opcional (spec 005) |

### Response `201`

```json
{
  "id": "pr_01J...",
  "type": "p2m",
  "incomingPaymentUrl": "https://ilp.interledger-test.dev/incoming-payments/...",
  "receiverWalletAddress": "https://ilp.interledger-test.dev/comercio-cafe",
  "amount": { "value": "10.50", "assetCode": "USD" },
  "receivedAmount": { "value": "0.00", "assetCode": "USD" },
  "description": "Café y pan",
  "status": "PENDING",
  "expiresAt": "2026-10-16T21:15:00.000Z",
  "createdAt": "2026-10-16T21:00:00.000Z"
}
```

`status` de una solicitud: `PENDING` · `COMPLETED` · `EXPIRED` (se refresca al
consultarla, spec 008).

### Servicio

`PaymentRequestsService.create`: `assertSafeWalletUrl` → `getWalletAddress` →
validar moneda → `createIncomingPayment` → `createPaymentRequest` en el repositorio.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Solicitud válida con monto | `201`; gateway recibe `"1050"` con scale 2; solicitud guardada |
| 2 | Integration | Solicitud sin monto | `201`; incoming payment sin monto |
| 3 | Integration | `assetCode` distinto al de la wallet | `422 ASSET_MISMATCH`; gateway no crea nada |
| 4 | Integration | Wallet inexistente | `422 WALLET_NOT_FOUND` |
| 5 | Integration | Wallet de host no permitido | `422 WALLET_NOT_ALLOWED`; sin llamadas de red |
| 6 | Integration | `expiresInSeconds` fuera de rango / campo desconocido | `400 VALIDATION_ERROR` |
| 7 | Integration | Falla Open Payments al crear el incoming payment | Error mapeado; nada guardado |
| 8 | Integration | Ruta agregada al test de rutas protegidas | `401` sin API key |

## Tareas

1. [ ] Schema y casos 1–7 en rojo.
2. [ ] `PaymentRequestsService.create` hasta pasar los casos.
3. [ ] Ruta, controller e idempotencia; caso 8.
4. [ ] Contrato en `openapi.yaml`.
5. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

Ninguna.
