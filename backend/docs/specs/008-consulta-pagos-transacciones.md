# 008 — Consulta de pagos y transacciones

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Spec aprobado; pendiente la autorización para iniciar el desarrollo. Depende del spec 007.

## Contexto

Después de iniciar un pago, el agente necesita saber cómo terminó, y los
usuarios necesitan ver su historial. Los datos vienen de la tabla de la API y
se actualizan contra Open Payments cuando un pago no está en estado final
([API.md — Dónde vive la información](../API.md#dónde-vive-la-información)).

## Alcance

**Incluye**
- `GET /api/v1/payments/{paymentId}` con refresco del estado.
- `GET /api/v1/transactions` con filtros y paginación.
- Refresco de solicitudes de pago (`PENDING` → `COMPLETED` / `EXPIRED`).
- Revocación de tokens al llegar a un estado final.
- Prueba E2E manual del flujo completo en la red de prueba.

**No incluye**
- Avisos al agente (spec 009).
- Transacciones que no se hicieron a través de la API.

## Criterios de aceptación

- **Dado** un pago en `PROCESSING`, **cuando** se consulta, **entonces** la API
  consulta el outgoing payment y, si terminó, guarda `COMPLETED` o `FAILED` y
  revoca el token.
- **Dado** un pago `PENDING_AUTHORIZATION` vencido, **cuando** se consulta,
  **entonces** se devuelve `EXPIRED`.
- **Dado** un pago en estado final, **cuando** se consulta, **entonces** no se
  llama a Open Payments.
- **Dado** una wallet, **cuando** se listan sus transacciones, **entonces** se
  obtienen sus pagos (como emisor o receptor) y sus solicitudes, del más reciente
  al más antiguo, con filtros y cursor.

## Diseño

### `GET /api/v1/payments/{paymentId}`

```json
{
  "paymentId": "pay_01J...",
  "type": "p2p",
  "status": "COMPLETED",
  "senderWalletAddress": "...",
  "receiverWalletAddress": "...",
  "debitAmount": { "value": "25.07", "assetCode": "USD" },
  "receiveAmount": { "value": "430.00", "assetCode": "MXN" },
  "sentAmount": { "value": "25.07", "assetCode": "USD" },
  "description": "Almuerzo",
  "error": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Regla de `COMPLETED`: `sentAmount` ≥ `debitAmount` del quote y el outgoing
payment no está `failed`.

### `GET /api/v1/transactions`

| Query | Regla |
|---|---|
| `walletAddress` | Obligatorio |
| `direction` | `incoming` · `outgoing` · `all` (por defecto) |
| `kind` | `payment` · `payment-request` · `all` (por defecto) |
| `status` | Opcional |
| `limit` / `cursor` | 1–100 (20) / opaco |

Response: `{ "items": [...], "nextCursor": "..." }`. Los elementos no finales
de la página se refrescan contra Open Payments antes de responder (con un
límite de concurrencia para no exceder el tiempo de API Gateway).

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Pago `PROCESSING` cuyo outgoing payment terminó | `COMPLETED`, guardado, token revocado |
| 2 | Integration | Outgoing payment `failed` | `FAILED`, token revocado |
| 3 | Integration | Outgoing payment aún en curso | Sigue `PROCESSING` |
| 4 | Integration | Pago `PENDING_AUTHORIZATION` vencido | `EXPIRED` |
| 5 | Integration | Pago en estado final | Sin llamadas al gateway |
| 6 | Integration | `paymentId` inexistente | `404 PAYMENT_NOT_FOUND` |
| 7 | Integration | Open Payments no responde al refrescar | Devuelve el último estado guardado con `stale: true` |
| 8 | Integration | Transacciones por emisor, receptor y `all`, con filtros | Elementos correctos y ordenados |
| 9 | Integration | Paginación con cursor | Sin duplicados ni faltantes |
| 10 | Integration | Solicitud pagada / vencida al listar | `COMPLETED` / `EXPIRED` |
| 11 | Integration | Rutas en el test de rutas protegidas | `401` sin API key |
| 12 | E2E | Solicitud → pago → aprobación manual → consulta hasta `COMPLETED` en la red de prueba | Fondos movidos |

## Tareas

1. [ ] `PaymentsService.getStatus`: casos 1–7 en rojo → implementación.
2. [ ] Ruta `GET /payments/{id}`.
3. [ ] `TransactionsService.list` y ruta: casos 8–11.
4. [ ] Contrato en `openapi.yaml`.
5. [ ] Script `pnpm test:e2e` y ejecución manual del caso 12.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

Ninguna.
