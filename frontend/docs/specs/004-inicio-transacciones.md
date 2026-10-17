# 004 — Inicio y transacciones

| Campo | Valor |
|---|---|
| Estado | **Hecho** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | 2026-10-17 |

## Estado

6 / 6 tareas completadas en `develop-andres` (167 tests en verde, lint y typecheck limpios). Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar el frontend).

## Contexto

La pantalla de inicio (mockups 1.5, 2.1, 3.1) es el punto de partida: saluda,
ofrece hablar con el agente, muestra accesos a comercios y las últimas
transacciones. Desde ahí el usuario abre la lista completa y el detalle de cada
pago. Los datos vienen de `GET /api/v1/transactions` y
`GET /api/v1/payments/{id}` ([backend 008](../../../backend/docs/specs/008-consulta-pagos-transacciones.md)).

## Alcance

**Incluye**
- Inicio: saludo con el nombre, botón al agente ("Toque y dígame qué pagar"), botón "Pagar un servicio", últimas 5 transacciones y enlace "Ver todas".
- Lista de transacciones con paginación por cursor (scroll infinito), filtro por estado (un estado a la vez) y *pull to refresh*.
- Detalle de una transacción: comercio, montos (recibido, comisión, total), estado, fecha, descripción, ID del pago como comprobante.
- Estados vacío, cargando y error con reintento.

**No incluye**
- Accesos rápidos a comercios favoritos con vencimientos ("vence el 24"): requiere datos de facturas que el backend no tiene. Los accesos del inicio llevan al directorio (spec 005).
- Solicitudes de pago entrantes (`kind=payment-request`): la app solo paga.
- Exportar o compartir comprobantes.

## Criterios de aceptación

- **Dado** un usuario con sesión, **cuando** abre el inicio, **entonces** ve "Hola, <nombre>. ¿Qué pagamos hoy?" y sus 5 transacciones más recientes.
- **Dado** que no tiene transacciones, **cuando** abre el inicio o la lista, **entonces** ve "Todavía no ha hecho pagos" y el botón "Pagar un servicio".
- **Dado** más de una página, **cuando** llega al final de la lista, **entonces** se carga la siguiente con `nextCursor` sin duplicar elementos.
- **Dado** el filtro "Exitosas", **cuando** lo escoge, **entonces** se pide `status=COMPLETED` y la lista se reinicia.
- **Dado** cada transacción, **cuando** se muestra, **entonces** tiene nombre del comercio (o la wallet si no está en el directorio), monto con su moneda, fecha relativa ("hoy, 3:24 p. m.") y `StatusBadge`.
- **Dado** una transacción no final en el detalle, **cuando** está abierta, **entonces** el estado se actualiza solo (polling con `Retry-After`, como el spec 007).
- **Dado** un error de la API, **cuando** carga, **entonces** ve `ErrorState` con "Reintentar"; un `401` cierra la sesión (spec 002).

## Diseño

### Rutas

`app/(app)/index.tsx`, `app/(app)/transacciones/index.tsx`,
`app/(app)/transacciones/[paymentId].tsx`.

### Datos

```ts
useTransactions({ status?, limit = 20 })   // useInfiniteQuery sobre GET /transactions
useRecentTransactions()                     // limit = 5
usePayment(paymentId)                       // GET /payments/{id}, compartido con 007
```

- Contrato del [backend 008](../../../backend/docs/specs/008-consulta-pagos-transacciones.md#diseño):
  `GET /transactions?direction=outgoing&kind=payment&status=&limit=&cursor=` →
  `{ items, nextCursor }`. La wallet sale de la sesión.
- **Cada página trae todos los datos de cada transacción** (nombre del
  comercio en `counterparty.name`, montos, comisión, estado, descripción): la
  lista no hace una petición por elemento. La siguiente página se pide al
  llegar al final (*lazy loading*) con `nextCursor`; `null` = no hay más.
- Filtro de un solo estado (`status`): "Todas" (sin `status`), "Exitosas"
  (`COMPLETED`), "En proceso" (`PROCESSING`), "Fallidas" (`FAILED`). Canceladas
  y vencidas solo aparecen en "Todas".
- Nombre: `counterparty.name`; si es `null`, se muestra el host y la ruta de la
  wallet.

### Componentes

`TransactionItem`, `TransactionList`, `TransactionDetail`, `StatusFilter`.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Fecha relativa (hoy, ayer, otra fecha) en `es-CO` | Textos esperados |
| 2 | unit | Mapeo filtro de la UI → `status` del query | Un estado por filtro; "Todas" sin `status` |
| 3 | component | `TransactionItem` por estado; `counterparty.name` con valor y `null` | Nombre, monto, fecha y badge; etiqueta accesible completa |
| 4 | integration | Inicio con transacciones | Saludo con nombre; 5 elementos; "Ver todas" navega a la lista |
| 5 | integration | Inicio y lista sin transacciones | `EmptyState` con "Pagar un servicio" |
| 6 | integration | Lista con 2 páginas | Al llegar al final pide `cursor`; sin duplicados; sin peticiones por elemento |
| 7 | integration | Cambio de filtro | Nueva petición con `status`; lista reiniciada |
| 8 | integration | *Pull to refresh* | Vuelve a pedir la primera página |
| 9 | integration | Detalle de pago `PROCESSING` → `COMPLETED` | Se actualiza solo; deja de consultar al ser final |
| 10 | integration | Error 500 y luego "Reintentar" | `ErrorState` y luego datos |

## Tareas

1. [x] Handlers MSW de `/transactions` (paginado y filtros) y `/payments/{id}` con fixtures por estado.
2. [x] Casos 1–2 en rojo → utilidades de fecha y filtros.
3. [x] Caso 3 en rojo → `TransactionItem`.
4. [x] Casos 4–5 en rojo → inicio.
5. [x] Casos 6–10 en rojo → lista y detalle.
6. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Filtro por varios estados | No: un solo `status` por consulta (2026-10-16) |
| 2 | Nombre del comercio | Lo devuelve el backend, con todos los datos de la transacción en lotes paginados para *lazy loading* (backend 008, 2026-10-16) |
| 3 | Nombre en el detalle | `GET /payments/{id}` no trae el nombre del comercio: el detalle lo toma de la lista ya cargada y, si no está, muestra host y ruta de la wallet (2026-10-17) |
| 4 | Fechas | Se muestran en hora de Bogotá (`America/Bogota`), igual que el día del monto diario del backend (2026-10-17) |
| 5 | Pruebas con timers | `expo-router/testing-library` usa timers falsos: los tests de polling avanzan el reloj con `jest.advanceTimersByTimeAsync` (2026-10-17) |

## Pendientes del backend (para validar con el responsable)

- `GET /payments/{id}` debería incluir `counterparty` (nombre del comercio) para que el detalle no dependa de la lista cargada.
