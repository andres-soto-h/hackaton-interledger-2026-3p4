# 022 — Panel de administración: actividad en vivo

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Ajustado el 2026-10-16: eventos de la vinculación,
la confirmación y la comisión (specs 007, 023 y 024); Cambios aprobados el 2026-10-16. Depende de
los specs 008 y 020.

## Contexto

En la demo queremos ver en vivo qué hace la app cuando se intenta procesar un
pago: se pidió el quote, se envió al usuario a autorizar, llegó el callback, el
hash no coincidió, el pago se completó…

**Por qué no mostrar directamente los logs de CloudWatch:**
- En Lambda cada instancia escribe sus propios logs, que tardan unos segundos en
  estar disponibles para consulta.
- La transmisión en vivo de CloudWatch (*Live Tail*) es una conexión abierta, y
  API Gateway corta las peticiones a los 29 s.
- En local no existe CloudWatch, y la vista debe funcionar igual en ambos lados.
- Los logs técnicos tienen ruido y datos que no deben llegar a una pantalla.

**Propuesta:** un **registro de actividad** propio. Los servicios emiten eventos
de negocio cortos, ya sin secretos, que se guardan en DynamoDB. El panel
consulta los nuevos cada 2 segundos (polling, igual que el agente en el spec
009). Los logs técnicos completos siguen en CloudWatch, y cada evento lleva el
`requestId` para buscarlos allí.

## Alcance

**Incluye**
- Eventos emitidos por los servicios de pagos y cuentas (specs 006, 007, 008 y
  019), usando el puerto `ActivityLog` creado en el spec 020.
- Página "Actividad en vivo" con filtros por pago, tipo y nivel.
- Lista de pagos y detalle con su línea de tiempo de eventos.
- Endpoint JSON del panel para el polling.

**No incluye**
- Mostrar logs crudos de CloudWatch (se enlaza la consulta por `requestId`).
- Alertas (las alarmas están en el spec 002).

## Criterios de aceptación

- **Dado** un pago en curso, **cuando** avanza un paso, **entonces** aparece un
  evento en la página de actividad en menos de 5 segundos.
- **Dado** un evento, **cuando** se guarda, **entonces** no contiene tokens,
  nonces, `interact_ref`, `hash`, llaves ni la API key.
- **Dado** un pago, **cuando** se abre su detalle, **entonces** se ve su línea de
  tiempo completa en orden.
- **Dado** que falla guardar un evento, **cuando** ocurre, **entonces** el pago
  sigue su curso (el registro de actividad nunca rompe un pago) y el fallo queda
  en el log técnico.
- **Dado** eventos con más de 7 días, **cuando** pasa el TTL, **entonces**
  DynamoDB los elimina.

## Diseño

### Evento

```json
{
  "id": "evt_01J...",
  "createdAt": "2026-10-16T21:00:01.123Z",
  "level": "info",
  "type": "payment.quote_created",
  "paymentId": "pay_01J...",
  "requestId": "c0a8...",
  "message": "Quote: 25.07 USD → 430.00 MXN",
  "data": { "debitAmount": "25.07 USD", "receiveAmount": "430.00 MXN" }
}
```

### Eventos principales

| Tipo | Nivel | Spec que lo emite |
|---|---|---|
| `payment_request.created` | info | 006 |
| `payment.quoted`, `payment.confirmed`, `payment.outgoing_created` | info | 007 |
| `payment.cancelled`, `payment.expired`, `payment.daily_limit_exceeded` | warn | 007 |
| `fee.collected` / `fee.failed` | info / error | 024 |
| `wallet_link.requested`, `wallet_link.callback_received`, `wallet_link.active` | info | 023 |
| `wallet_link.rejected`, `wallet_link.expired`, `wallet_link.revoked` | warn | 023 |
| `wallet_link.callback_invalid` (hash no coincide, callback repetido) | warn | 023 |
| `wallet_link.token_rotated` | info | 023 |
| `payment.failed` (con `error.code`) | error | 007, 008 |
| `payment.completed` | info | 008 |
| `user.registered`, `user.deleted`, `user.*` del panel | info | 019, 021 |
| `settings.updated` (valor anterior y nuevo) | info | 020 |

`data` se construye con una lista de campos permitidos por tipo de evento (no
se copia el objeto completo), y pasa por la misma redacción del logger (spec 005).

### Almacenamiento

- Misma tabla, `entityType = "event"`; se consulta con el índice `byType`
  ordenado por `createdAt`.
- Para la línea de tiempo de un pago: índice `byPayment` (`paymentId` + `createdAt`).
- TTL de 7 días (`expiresAt`).
- La escritura no bloquea la respuesta de forma crítica: se espera con un
  timeout corto y, si falla, solo se registra en el log técnico.

### Rutas del panel

| Ruta | Qué hace |
|---|---|
| `GET /admin/activity` | Página de actividad en vivo |
| `GET /admin/activity/feed?after=<cursor>&paymentId=&type=&level=` | JSON con los eventos nuevos (máx. 100) y el cursor siguiente |
| `GET /admin/payments?status=&cursor=` | Lista de pagos |
| `GET /admin/payments/{id}` | Detalle del pago y su línea de tiempo |

La página usa un script propio (`/admin/assets/activity.js`) que consulta
`feed` cada 2 s, agrega las filas nuevas arriba con `textContent` (nunca
`innerHTML`) y se pausa cuando la pestaña no está visible. Botón para pausar y
reanudar.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Flujo de pago completo con fakes | Eventos esperados en orden, con `paymentId` y `requestId` |
| 2 | Integration | Callback de vinculación con hash inválido | `wallet_link.callback_invalid` nivel `warn` |
| 3 | Unit | Eventos de pago construidos con datos que incluyen tokens, nonces o `hash` | No aparecen en el evento guardado |
| 4 | Integration | `ActivityLog` que falla | El pago continúa y responde normal |
| 5 | Integration | `feed` con y sin cursor, con filtros | Solo eventos nuevos y filtrados; máx. 100 |
| 6 | Integration | Detalle de un pago | Datos y línea de tiempo ordenada |
| 7 | Integration | Rutas sin sesión de administrador | `302` al login (páginas) / `401` (feed) |
| 8 | Manual | Hacer un pago en la red de prueba con la página abierta | Los eventos aparecen en vivo |

## Tareas

1. [ ] Tipos de eventos de pago y cuentas con sus campos permitidos (caso 3).
2. [ ] Emitir eventos desde los servicios de pagos y cuentas (casos 1, 2 y 4).
3. [ ] Endpoint `feed` (caso 5) y página con polling.
4. [ ] Lista y detalle de pagos (caso 6).
5. [ ] Protección de rutas (caso 7) y prueba manual (caso 8).
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Fuente de la actividad en vivo | Registro de actividad propio en DynamoDB (2026-10-16) |

## Decisiones pendientes

Ninguna.

## Notas

- El índice `byPayment` lo crea el spec 002 (tarea 20).
