# 007 — Resultado de la transacción

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 5 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

Después de aprobar (o rechazar) en su wallet, el usuario vuelve a la app y debe
saber, sin dudas, qué pasó con su plata (mockups 1.8, 2.5, 3.6). El backend
redirige a `FRONTEND_RESULT_URL?paymentId=…&status=…[&error=…]`
([backend 007](../../../backend/docs/specs/007-pago-y-autorizacion.md#respuesta-del-callback)),
pero ese `status` suele ser `PROCESSING`: el estado final se obtiene consultando
`GET /payments/{id}` según `isFinal` y `Retry-After`
([backend 009](../../../backend/docs/specs/009-seguimiento-estado-agente.md)).

## Alcance

**Incluye**
- Ruta de retorno `/pagos/resultado` (requiere sesión) que acepta `paymentId`, `status` y `error`.
- Polling de `GET /payments/{id}` respetando `Retry-After`, hasta `isFinal: true`, con un tiempo máximo.
- Pantalla por estado: procesando, exitoso (comprobante), rechazado, fallido, vencido.
- Acciones: "Pagar algo más" (directorio), "Ver mis transacciones", "Ir al inicio".

**No incluye**
- "Enviar comprobante a un familiar" (backlog).
- Notificaciones push cuando cambia el estado.

## Criterios de aceptación

- **Dado** el retorno con `status=PROCESSING`, **cuando** abre el resultado, **entonces** ve "Enviando el pago…" y la app consulta el estado cada `Retry-After` segundos.
- **Dado** que la consulta llega a `COMPLETED`, **cuando** se actualiza, **entonces** ve "Listo. Su pago quedó hecho", el comercio, el valor, el total pagado, la hora ("<comercio> lo recibió a las 3:24 p. m.") y el comprobante (`paymentId`), y se anuncia al lector de pantalla.
- **Dado** `REJECTED`, **cuando** se muestra, **entonces** ve "Usted no aprobó el pago. No se movió ni un peso" y "Intentar de nuevo".
- **Dado** `FAILED` o `EXPIRED`, **cuando** se muestra, **entonces** ve qué pasó en lenguaje simple (según `error.code`) y que no se debitó nada si `sentAmount` es cero.
- **Dado** un estado final, **cuando** se muestra, **entonces** la app deja de consultar.
- **Dado** que pasan 2 minutos sin estado final, **cuando** se cumple el tiempo, **entonces** deja de consultar y ve "El pago sigue en proceso. Lo puede revisar en sus transacciones" con un botón para consultar de nuevo.
- **Dado** que no hay sesión al volver (p. ej. otra pestaña en web), **cuando** abre el resultado, **entonces** ingresa (spec 002) y vuelve al resultado.
- **Dado** un `paymentId` inexistente o de otro usuario (`404`), **cuando** abre el resultado, **entonces** ve "No encontramos ese pago" y "Ir al inicio".
- **Dado** el `status` del query, **cuando** se muestra, **entonces** solo se usa como estado inicial; lo que se muestra como final siempre viene de la API (el query se puede manipular).

## Diseño

### Ruta

`app/(app)/pagos/resultado.tsx`. Está en `(app)` (requiere sesión); el guard
del 002 conserva el query al redirigir a ingresar.

### Polling

```ts
usePaymentStatus(paymentId): { payment, phase: "polling" | "final" | "timeout" | "notFound", retry }
```

- `refetchInterval` = `Retry-After` de la última respuesta (en segundos; por
  defecto 3 s si no viene), deja de consultar con `isFinal: true`.
- Tiempo máximo 2 min (configurable), luego `timeout`.
- Comparte la caché con `usePayment` del 004.

### Textos por estado

| Estado | Título | Detalle |
|---|---|---|
| `PROCESSING` / `PENDING_AUTHORIZATION` | Enviando el pago… | "Esto toma unos segundos." |
| `COMPLETED` | Listo. Su pago quedó hecho. | "<comercio> lo recibió a las <hora>." + desglose + comprobante |
| `REJECTED` | Usted no aprobó el pago | "No se movió ni un peso." |
| `FAILED` | El pago no se pudo hacer | Según `error.code`; si `sentAmount` es 0: "No se debitó nada." |
| `EXPIRED` | Se venció el tiempo para aprobar | "No se movió ni un peso. Puede prepararlo otra vez." |

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `usePaymentStatus` con reloj falso: `Retry-After` 2 → 5, luego final | Intervalos respetados; se detiene en final |
| 2 | unit | `usePaymentStatus`: sin final en 2 min; `404` | `timeout`; `notFound` |
| 3 | integration | Retorno `PROCESSING` → `COMPLETED` | Procesando y luego comprobante con hora y montos; anuncio accesible |
| 4 | integration | `REJECTED`, `FAILED` (con y sin envío parcial), `EXPIRED` | Título y detalle de cada estado |
| 5 | integration | Query `status=COMPLETED` pero la API dice `PROCESSING` | Muestra procesando (manda la API) |
| 6 | integration | Retorno sin sesión | Ingresa y vuelve al resultado con el mismo `paymentId` |
| 7 | integration | Acciones "Pagar algo más" / "Ver mis transacciones" | Navegan al directorio / lista |

## Tareas

1. [ ] Handlers MSW de `/payments/{id}` con secuencias de estados y `Retry-After`.
2. [ ] Casos 1–2 en rojo → `usePaymentStatus`.
3. [ ] Casos 3–7 en rojo → pantalla de resultado.
4. [ ] Configurar `FRONTEND_RESULT_URL` del backend con la ruta de la app web (coordinar con el backend 002).
5. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Hora de recepción:** el mockup dice "lo recibió a las 3:24". ¿El backend
   expone cuándo se completó (`completedAt`)? Si no, se usa `updatedAt`.
