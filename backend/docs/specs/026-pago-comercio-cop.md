# 026 — Pago a comercio con la wallet del receptor (solo COP)

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-17 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 4 tareas completadas. Borrador pendiente de aprobación. Ajusta el contrato
de `POST /payments` del [spec 007](007-pago-y-autorizacion.md) (Hecho). Surge de
la decisión del responsable del 2026-10-17 a partir de la pregunta del frontend
([frontend 005](../../../frontend/docs/specs/005-pago-servicios.md)).

## Contexto

El spec 007 define `p2m` solo con `incomingPaymentUrl`, pero en la app el usuario
escribe el valor de la factura y elige un comercio del directorio. Para
simplificar, el cliente envía la **wallet del comercio y el monto**, y el
backend crea el incoming payment. Para que ese monto sea inequívoco se restringe
el pago a comercios a **una sola moneda: COP**.

## Alcance

**Incluye**
- `p2m` con `receiverWalletAddress` + `amount` (obligatorios) como variante principal; `incomingPaymentUrl` queda como variante opcional.
- Validación: `amount.assetCode` de un `p2m` debe ser `COP`; si no, `422 MERCHANT_CURRENCY_NOT_SUPPORTED`.
- Validación de que la wallet del receptor está en COP.

**No incluye**
- Restringir los pagos `p2p` (siguen multimoneda, spec 003).
- El directorio de comercios y la verificación de wallet (sin spec todavía; ver [KANBAN](../KANBAN.md#backlog-specs-por-escribir)).
- Restringir la moneda del emisor: el usuario puede pagar desde una wallet USD y el quote convierte a COP.

## Criterios de aceptación

- **Dado** un `p2m` con `receiverWalletAddress` y `amount` en COP, **cuando** se cotiza, **entonces** responde `201` con el quote (`receiveAmount` fijo en COP).
- **Dado** un `p2m` con `amount.assetCode` distinto de COP, **cuando** se cotiza, **entonces** responde `422 MERCHANT_CURRENCY_NOT_SUPPORTED` sin llamar a Open Payments.
- **Dado** un `p2m` cuya wallet de receptor no está en COP, **cuando** se cotiza, **entonces** responde `422 MERCHANT_CURRENCY_NOT_SUPPORTED`.
- **Dado** un `p2m` sin `amount` y sin `incomingPaymentUrl`, **cuando** llega, **entonces** `400 VALIDATION_ERROR`.
- **Dado** un `p2p`, **cuando** se cotiza, **entonces** se comporta como hoy (cualquier moneda soportada).

## Diseño

```json
{ "type": "p2m", "receiverWalletAddress": "https://ilp.interledger-test.dev/epm",
  "amount": { "value": "86400.00", "assetCode": "COP" }, "description": "EPM · contrato 7731" }
```

- Zod: unión discriminada por `type`; `p2m` acepta (`receiverWalletAddress` + `amount`) o `incomingPaymentUrl`.
- El `amount` del `p2m` fija el monto de llegada (`receiveAmount`), igual que el p2p cuando el receptor define la cantidad.
- Error nuevo: `MERCHANT_CURRENCY_NOT_SUPPORTED` (422).

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Unit | Schema `p2m` con wallet + monto COP / con `incomingPaymentUrl` / sin ninguno | Acepta / acepta / `VALIDATION_ERROR` |
| 2 | Integration | `p2m` en COP, emisor USD | `201`; ambos montos y `exchangeRate` |
| 3 | Integration | `p2m` en USD o MXN | `422 MERCHANT_CURRENCY_NOT_SUPPORTED`; sin llamadas a Open Payments |
| 4 | Integration | `p2m` con wallet del receptor en otra moneda | `422 MERCHANT_CURRENCY_NOT_SUPPORTED` |
| 5 | Integration | `p2p` en USD | Sin cambios |

## Tareas

1. [ ] Casos 1–5 en rojo.
2. [ ] Schema y validación de moneda en `PaymentsService.quote`.
3. [ ] Contrato en `openapi.yaml` y [API.md](../API.md).
4. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Moneda de los pagos a comercios | Solo COP (responsable, 2026-10-17) |
| 2 | Body del `p2m` | `receiverWalletAddress` + `amount` (responsable, 2026-10-17) |

## Decisiones pendientes

Ninguna.
