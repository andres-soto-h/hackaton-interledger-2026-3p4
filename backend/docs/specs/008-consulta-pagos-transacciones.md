# 008 — Consulta de pagos y transacciones

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

5 / 6 tareas completadas e integradas y cableadas en `develop-andres` (1051 tests, más 105 contra DynamoDB Local, typecheck y lint en verde). **Solo falta la ejecución manual del caso 12** (flujo completo contra la red de prueba real con `pnpm test:e2e`, tarea 5), que es una acción del responsable ([PENDIENTES-RESPONSABLE](../PENDIENTES-RESPONSABLE.md)); el script ya existe y se salta limpio sin credenciales. Ajustado el 2026-10-16 por el monto diario preaprobado
(spec 023) y la comisión (spec 024); Cambios aprobados el 2026-10-16. Depende de
los specs 007, 023 y 024.

**Qué cambió respecto a la versión aprobada:**
- Las consultas usan la **sesión del usuario** y solo devuelven lo suyo; la API
  key ya no lee pagos ni transacciones (lo pide también el frontend).
- `GET /transactions` toma la wallet de la cuenta; ya no recibe `walletAddress`.
- El outgoing payment se lee con el token de la vinculación; ya no se revoca un
  token al terminar cada pago (el token es del monto diario y sigue vigente).
- Al terminar: se libera de la reserva lo no gastado; se reintenta la comisión fallida.
- La respuesta incluye la comisión y su estado.
- `GET /transactions` devuelve **todos los datos de cada transacción en un solo
  lote por página** (incluido el nombre del comercio o receptor), paginado con
  cursor para carga perezosa (*lazy loading*). El frontend no pide nada más por
  cada elemento. `status` acepta un solo valor (definido el 2026-10-16 con el
  frontend 004).

## Contexto

Después de confirmar un pago, la app necesita saber cómo terminó, y los
usuarios necesitan ver su historial. Los datos vienen de la tabla de la API y
se actualizan contra Open Payments cuando un pago no está en estado final
([API.md — Dónde vive la información](../API.md#dónde-vive-la-información)).

## Alcance

**Incluye**
- `GET /api/v1/payments/{paymentId}` con refresco del estado.
- `GET /api/v1/transactions` con filtros y paginación.
- Refresco de solicitudes de pago (`PENDING` → `COMPLETED` / `EXPIRED`).
- Liberar de la reserva diaria lo no gastado al llegar a un estado final.
- Reintento de la comisión fallida (spec 024).
- Prueba E2E manual del flujo completo en la red de prueba.

**No incluye**
- El contrato de polling (spec 009).
- Transacciones que no se hicieron a través de la API.

## Criterios de aceptación

- **Dado** un pago en `PROCESSING`, **cuando** se consulta, **entonces** la API
  consulta el outgoing payment con el token de la vinculación y, si terminó,
  guarda `COMPLETED` o `FAILED` y libera de la reserva lo no gastado.
- **Dado** un pago `AWAITING_CONFIRMATION` cuyo quote venció, **cuando** se
  consulta, **entonces** se devuelve `EXPIRED`.
- **Dado** un pago de otro usuario, **cuando** se consulta, **entonces**
  responde `404 PAYMENT_NOT_FOUND`.
- **Dado** un pago en estado final, **cuando** se consulta, **entonces** no se
  llama a Open Payments.
- **Dado** un usuario con sesión, **cuando** lista sus transacciones,
  **entonces** se obtienen los pagos de su wallet (como emisor o receptor) y sus solicitudes, del más reciente
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
  "fee": { "value": "0.38", "assetCode": "USD", "percentage": "1.5" },
  "feeStatus": "COLLECTED",
  "totalDebit": { "value": "25.45", "assetCode": "USD" },
  "description": "Almuerzo",
  "error": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Regla de `COMPLETED`: `sentAmount` ≥ `debitAmount` del quote y el outgoing
payment no está `failed`.

### `GET /api/v1/transactions`

La wallet es la de la cuenta de la sesión.

| Query | Regla |
|---|---|
| `direction` | `incoming` · `outgoing` · `all` (por defecto) |
| `kind` | `payment` · `payment-request` · `all` (por defecto) |
| `status` | Opcional |
| `limit` / `cursor` | 1–100 (20) / opaco |

Response: `{ "items": [...], "nextCursor": "..." }`. Cada elemento trae todo lo
que la app muestra, para no hacer una petición por elemento:

```json
{
  "id": "pay_01J...",
  "kind": "payment",
  "direction": "outgoing",
  "type": "p2m",
  "status": "COMPLETED",
  "counterparty": { "name": "EPM", "walletAddress": "https://ilp.interledger-test.dev/epm", "merchantId": "mer_epm" },
  "debitAmount": { "value": "86401", "assetCode": "COP" },
  "receiveAmount": { "value": "86400", "assetCode": "COP" },
  "fee": { "value": "1", "assetCode": "COP", "percentage": "0.001" },
  "totalDebit": { "value": "86401", "assetCode": "COP" },
  "description": "EPM · contrato 7731",
  "createdAt": "...",
  "updatedAt": "..."
}
```

- `counterparty.name`: nombre del comercio del directorio si la wallet es de un
  comercio; si no, el `publicName` de la wallet; si no hay, `null`.
- `nextCursor` es `null` en la última página; la app pide la siguiente página
  cuando el usuario llega al final de la lista.

Los elementos no finales
de la página se refrescan contra Open Payments antes de responder (con un
límite de concurrencia para no exceder el tiempo de API Gateway).

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Pago `PROCESSING` cuyo outgoing payment terminó | `COMPLETED`, guardado, leído con el token de la vinculación; reserva ajustada a lo gastado |
| 2 | Integration | Outgoing payment `failed` | `FAILED`; reserva liberada |
| 3 | Integration | Outgoing payment aún en curso | Sigue `PROCESSING` |
| 4 | Integration | Pago `AWAITING_CONFIRMATION` con quote vencido | `EXPIRED` |
| 5 | Integration | Pago en estado final | Sin llamadas al gateway |
| 6 | Integration | `paymentId` inexistente / de otro usuario | `404 PAYMENT_NOT_FOUND` |
| 7 | Integration | Open Payments no responde al refrescar | Devuelve el último estado guardado con `stale: true` |
| 8 | Integration | Transacciones por emisor, receptor y `all`, con filtros | Elementos correctos y ordenados |
| 9 | Integration | Paginación con cursor | Sin duplicados ni faltantes |
| 10 | Integration | Solicitud pagada / vencida al listar | `COMPLETED` / `EXPIRED` |
| 11 | Integration | Rutas en el test de rutas protegidas; `walletAddress` en el query | `401` sin sesión, también con API key / `400 VALIDATION_ERROR` |
| 13 | Integration | Elemento de la lista de un comercio del directorio / de una wallet sin comercio | `counterparty.name` del directorio / `publicName` o `null`; todos los campos del contrato presentes |
| 12 | E2E | Registro → vincular wallet (aprobación manual) → solicitud → cotizar → confirmar → consulta hasta `COMPLETED` en la red de prueba | Fondos y comisión movidos |

## Tareas

1. [x] `PaymentsService.getStatus`: casos 1–7 en rojo → implementación.
2. [x] Ruta `GET /payments/{id}`.
3. [x] `TransactionsService.list` y ruta: casos 8–11 y 13.
4. [x] Contrato en `openapi.yaml`.
5. [~] Script `pnpm test:e2e` y ejecución manual del caso 12.
6. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

Ninguna.
