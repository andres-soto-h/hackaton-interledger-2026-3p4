# 013 — Inicio y transacciones

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

La pantalla de inicio (mockups 1.5, 2.1, 3.1) es el punto de partida: saluda,
ofrece hablar con el agente, muestra accesos a comercios y las últimas
transacciones. Desde ahí el usuario abre la lista completa y el detalle de cada
pago. Los datos vienen de `GET /api/v1/transactions` y
`GET /api/v1/payments/{id}` (spec [008 del backend](../../../backend/docs/specs/008-consulta-pagos-transacciones.md)).

## Alcance

**Incluye**
- Inicio: saludo con el nombre, botón al agente ("Toque y dígame qué pagar"), botón "Pagar un servicio", últimas 5 transacciones y enlace "Ver todas".
- Lista de transacciones con paginación por cursor (scroll infinito), filtro por estado (todas, en curso, exitosas, no realizadas) y *pull to refresh*.
- Detalle de una transacción: comercio, montos (débito, recibido), estado, fecha, descripción, ID del pago como comprobante.
- Estados vacío, cargando y error con reintento.

**No incluye**
- Accesos rápidos a comercios favoritos con vencimientos ("vence el 24"): requiere datos de facturas que el backend no tiene. Los accesos del inicio llevan al directorio (spec 014).
- Solicitudes de pago entrantes (`kind=payment-request`): la app solo paga.
- Exportar o compartir comprobantes.

## Criterios de aceptación

- **Dado** un usuario con sesión, **cuando** abre el inicio, **entonces** ve "Hola, <nombre>. ¿Qué pagamos hoy?" y sus 5 transacciones más recientes.
- **Dado** que no tiene transacciones, **cuando** abre el inicio o la lista, **entonces** ve "Todavía no ha hecho pagos" y el botón "Pagar un servicio".
- **Dado** más de una página, **cuando** llega al final de la lista, **entonces** se carga la siguiente con `nextCursor` sin duplicar elementos.
- **Dado** el filtro "Exitosas", **cuando** lo escoge, **entonces** se pide `status=COMPLETED` y la lista se reinicia.
- **Dado** cada transacción, **cuando** se muestra, **entonces** tiene nombre del comercio (o la wallet si no está en el directorio), monto con su moneda, fecha relativa ("hoy, 3:24 p. m.") y `StatusBadge`.
- **Dado** una transacción no final en el detalle, **cuando** está abierta, **entonces** el estado se actualiza solo (polling con `Retry-After`, como el spec 016).
- **Dado** un error de la API, **cuando** carga, **entonces** ve `ErrorState` con "Reintentar"; un `401` cierra la sesión (spec 012).

## Diseño

### Rutas

`app/(app)/index.tsx`, `app/(app)/transacciones/index.tsx`,
`app/(app)/transacciones/[paymentId].tsx`.

### Datos

```ts
useTransactions({ status?, limit = 20 })   // useInfiniteQuery sobre GET /transactions
useRecentTransactions()                     // limit = 5
usePayment(paymentId)                       // GET /payments/{id}, compartido con 016
```

- Contrato de [008](../../../backend/docs/specs/008-consulta-pagos-transacciones.md#diseño):
  `GET /transactions?direction=outgoing&kind=payment&status=&limit=&cursor=` →
  `{ items, nextCursor }`. La wallet sale del token (pendiente en el backend;
  ver [PLAN.md](../PLAN.md#dependencias-con-el-backend)).
- Filtros de la UI → estados: "En curso" = `PENDING_AUTHORIZATION`,
  `PROCESSING`; "Exitosas" = `COMPLETED`; "No realizadas" = `FAILED`,
  `REJECTED`, `EXPIRED`. Si el backend solo acepta un `status`, "En curso" y
  "No realizadas" filtran en el cliente (decisión pendiente 1).
- Nombre del comercio: se cruza `receiverWalletAddress` con el directorio
  (spec 014, cacheado); si no está, se muestra el host y la ruta de la wallet.

### Componentes

`TransactionItem`, `TransactionList`, `TransactionDetail`, `StatusFilter`.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Fecha relativa (hoy, ayer, otra fecha) en `es-CO` | Textos esperados |
| 2 | unit | Mapeo filtro de la UI → query / filtro en cliente | Estados correctos por filtro |
| 3 | component | `TransactionItem` por estado; comercio conocido y desconocido | Nombre, monto, fecha y badge; etiqueta accesible completa |
| 4 | integration | Inicio con transacciones | Saludo con nombre; 5 elementos; "Ver todas" navega a la lista |
| 5 | integration | Inicio y lista sin transacciones | `EmptyState` con "Pagar un servicio" |
| 6 | integration | Lista con 2 páginas | Al llegar al final pide `cursor`; sin duplicados |
| 7 | integration | Cambio de filtro | Nueva petición con `status`; lista reiniciada |
| 8 | integration | *Pull to refresh* | Vuelve a pedir la primera página |
| 9 | integration | Detalle de pago `PROCESSING` → `COMPLETED` | Se actualiza solo; deja de consultar al ser final |
| 10 | integration | Error 500 y luego "Reintentar" | `ErrorState` y luego datos |

## Tareas

1. [ ] Handlers MSW de `/transactions` (paginado y filtros) y `/payments/{id}` con fixtures por estado.
2. [ ] Casos 1–2 en rojo → utilidades de fecha y filtros.
3. [ ] Caso 3 en rojo → `TransactionItem`.
4. [ ] Casos 4–5 en rojo → inicio.
5. [ ] Casos 6–10 en rojo → lista y detalle.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Filtro por varios estados:** ¿el backend acepta `status` múltiple
   (`status=FAILED,REJECTED`)? Recomendación: sí, es un cambio pequeño en 008.
2. **Nombre del comercio en la transacción:** cruzarlo en el cliente con el
   directorio o que el backend lo devuelva. Recomendación: el backend
   (`receiverName`), cuando exista el directorio.
