# 007 — Resultado de la transacción

| Campo | Valor |
|---|---|
| Estado | **Hecho** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | 2026-10-17 |

## Estado

4 / 4 tareas completadas en `develop-andres` (274 tests en verde, lint y typecheck limpios). Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar el frontend).

## Contexto

Después de confirmar en la app (spec 006), el usuario debe saber, sin dudas,
qué pasó con su plata (mockups 1.8, 2.5, 3.6). La confirmación responde
`PROCESSING`; el estado final se obtiene consultando `GET /payments/{id}` según
`isFinal` y `Retry-After`
([backend 008](../../../backend/docs/specs/008-consulta-pagos-transacciones.md) y
[backend 009](../../../backend/docs/specs/009-seguimiento-estado-agente.md)).

## Alcance

**Incluye**
- Ruta `/pagos/resultado/[paymentId]` (requiere sesión).
- Polling de `GET /payments/{id}` respetando `Retry-After`, hasta `isFinal: true`, con un tiempo máximo.
- Pantalla por estado: procesando, exitoso (comprobante), fallido, cancelado, vencido.
- Acciones: "Pagar algo más" (directorio), "Ver mis transacciones", "Ir al inicio".

**No incluye**
- "Enviar comprobante a un familiar" (backlog).
- Notificaciones push cuando cambia el estado.

## Criterios de aceptación

- **Dado** un pago `PROCESSING`, **cuando** abre el resultado, **entonces** ve "Enviando el pago…" y la app consulta el estado cada `Retry-After` segundos.
- **Dado** que llega a `COMPLETED`, **cuando** se actualiza, **entonces** ve "Listo. Su pago quedó hecho", el comercio, el valor, la comisión, el total pagado, la hora ("<comercio> lo recibió a las 3:24 p. m."), cuánto le queda del monto de hoy y el comprobante (`paymentId`), y se anuncia al lector de pantalla.
- **Dado** `FAILED`, **cuando** se muestra, **entonces** ve qué pasó en lenguaje simple (según `error.code`) y que no se debitó nada si `sentAmount` es cero.
- **Dado** `CANCELLED` o `EXPIRED`, **cuando** se muestra, **entonces** ve "No se movió ni un peso" y "Preparar el pago otra vez".
- **Dado** un estado final, **cuando** se muestra, **entonces** la app deja de consultar.
- **Dado** que pasan 2 minutos sin estado final, **cuando** se cumple el tiempo, **entonces** deja de consultar y ve "El pago sigue en proceso. Lo puede revisar en sus transacciones" con un botón para consultar de nuevo.
- **Dado** que recarga la página en web, **cuando** vuelve a cargar, **entonces** sigue viendo el mismo resultado (el `paymentId` está en la URL).
- **Dado** un `paymentId` inexistente o de otro usuario (`404`), **cuando** abre el resultado, **entonces** ve "No encontramos ese pago" y "Ir al inicio".

## Diseño

### Ruta

`app/(app)/pagos/resultado/[paymentId].tsx`.

### Polling

```ts
usePaymentStatus(paymentId): { payment, phase: "polling" | "final" | "timeout" | "notFound", retry }
```

- `refetchInterval` = `Retry-After` de la última respuesta (en segundos; por
  defecto 3 s si no viene); deja de consultar con `isFinal: true`.
- Tiempo máximo 2 min (configurable), luego `timeout`.
- Comparte la caché con `usePayment` del 004.
- "Le queda hoy" sale de `GET /me/allowance` (spec 002) al llegar a `COMPLETED`.

### Textos por estado

| Estado | Título | Detalle |
|---|---|---|
| `PROCESSING` | Enviando el pago… | "Esto toma unos segundos." |
| `COMPLETED` | Listo. Su pago quedó hecho. | "<comercio> lo recibió a las <hora>." + desglose con comisión (`fee`, `totalDebit`) + comprobante |
| `FAILED` | El pago no se pudo hacer | Según `error.code`; si `sentAmount` es 0: "No se debitó nada." |
| `CANCELLED` | Usted canceló el pago | "No se movió ni un peso." |
| `EXPIRED` | Se venció el tiempo para confirmar | "No se movió ni un peso. Puede prepararlo otra vez." |

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `usePaymentStatus` con reloj falso: `Retry-After` 2 → 5, luego final | Intervalos respetados; se detiene en final |
| 2 | unit | `usePaymentStatus`: sin final en 2 min; `404` | `timeout`; `notFound` |
| 3 | integration | `PROCESSING` → `COMPLETED` | Procesando y luego comprobante con hora, comisión, total y disponible; anuncio accesible |
| 4 | integration | `FAILED` (con y sin envío parcial), `CANCELLED`, `EXPIRED` | Título y detalle de cada estado |
| 5 | integration | Acciones "Pagar algo más" / "Ver mis transacciones" | Navegan al directorio / lista |

## Tareas

1. [x] Handlers MSW de `/payments/{id}` con secuencias de estados y `Retry-After`.
2. [x] Casos 1–2 en rojo → `usePaymentStatus`.
3. [x] Casos 3–5 en rojo → pantalla de resultado.
4. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Hora de recepción | Se usa `updatedAt` (hora de Bogotá) porque el backend no expone `completedAt` (2026-10-17) |
| 2 | Estado repetido | La pantalla no muestra además el `StatusBadge`: el título ya dice el estado |
| 3 | Intervalo por omisión | 3 s si la API no manda `Retry-After` (antes 2 s en el detalle del spec 004) |

## Pendientes del backend (para validar con el responsable)

- Exponer `completedAt` en `GET /payments/{id}` para mostrar la hora exacta de recepción.

## Notas

- La vuelta desde la wallet (`FRONTEND_RESULT_URL`) ahora es solo para la
  vinculación (spec 003); los pagos ya no pasan por la wallet.
