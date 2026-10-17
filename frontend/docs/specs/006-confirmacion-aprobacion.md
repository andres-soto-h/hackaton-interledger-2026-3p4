# 006 — Confirmación del pago

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec aprobado; pendiente la autorización para iniciar el desarrollo.

> 2026-10-16: el usuario **ya no aprueba cada pago en su wallet**. Aprueba una
> sola vez al vincular la wallet en el registro (spec 003, backend 023) y cada
> pago lo confirma **en la app con su passkey**. Si la prueba de la tarea 1
> muestra que el pago sin autorización desde la wallet no funciona, este spec y
> el backend se ajustan.

## Contexto

Antes de que se mueva un peso, el usuario ve exactamente cuánto paga, a quién,
la comisión y cuánto le queda del monto diario (mockups 1.7, 2.4, 3.5: "Revisar
y decir sí"). Si está de acuerdo, confirma con su passkey (huella o desbloqueo
del dispositivo) y el pago sale con el permiso que dio al vincular la wallet,
sin ir a la wallet ("Sí, sin volver a autorizar", mockup 2.4). El passkey exige
que el usuario esté presente: ni el agente ni alguien con la sesión pueden
confirmar por él. La misma pantalla la usan los pagos manuales (005) y los que
prepara el agente (008). Contrato en el
[backend 007](../../../backend/docs/specs/007-pago-y-autorizacion.md#confirmación-con-passkey).

## Alcance

**Incluye**
- Pantalla de confirmación a partir de la respuesta de `POST /payments` (o de `GET /payments/{id}` si se abre de nuevo).
- Desglose: le paga a, valor que recibe, tasa de cambio (si las monedas son distintas), comisión TuTranqui, total que sale y cuánto le queda del monto diario después del pago.
- Mensaje hablado del resumen (texto accesible con `toSpokenAmount`; lo usa la voz del spec 009).
- Cuenta regresiva hasta `confirmBy`; al vencer se deshabilita la confirmación.
- "Sí, pagar": desafío de confirmación → passkey → `POST /payments/{id}/confirm` → resultado (007).
- "Repítamelo" (vuelve a anunciar el resumen) y "No pagar" (`POST /payments/{id}/cancel` y vuelve al inicio).

**No incluye**
- El resultado después de confirmar (spec 007).
- Abrir la wallet para aprobar el pago (ya no hace falta).

## Criterios de aceptación

- **Dado** un pago `AWAITING_CONFIRMATION`, **cuando** abre la confirmación, **entonces** ve el comercio, el valor que recibe, la comisión, el total y "Le quedan <disponible> de su monto de hoy", todos con su moneda.
- **Dado** monedas distintas, **cuando** se muestra, **entonces** también ve la tasa (`quote.exchangeRate`) con aviso de que vale hasta que vence.
- **Dado** el lector de pantalla, **cuando** entra, **entonces** se anuncia "La factura es de ochenta y seis mil cuatrocientos pesos, más un peso de comisión. ¿Hacemos el pago?".
- **Dado** "Sí, pagar", **cuando** confirma con su passkey, **entonces** se llama `confirm/options` y luego `confirm` con `challengeId` y la firma, y al recibir `202 PROCESSING` va al resultado (007).
- **Dado** que cancela el diálogo del passkey, **cuando** vuelve, **entonces** sigue en la confirmación y el pago no se hace.
- **Dado** `422 DAILY_LIMIT_EXCEEDED`, **cuando** confirma, **entonces** ve "Este pago pasa su monto de hoy" con cuánto le queda; no se debita nada.
- **Dado** `410 QUOTE_EXPIRED` o que llega a 0 la cuenta regresiva, **cuando** ocurre, **entonces** ve "Se venció el tiempo. Prepare el pago otra vez".
- **Dado** `400 CHALLENGE_EXPIRED` o `PASSKEY_VERIFICATION_FAILED`, **cuando** ocurre, **entonces** puede reintentar la confirmación.
- **Dado** `403 WALLET_NOT_LINKED` o `409 WALLET_LINK_REVOKED`, **cuando** ocurre, **entonces** ve que debe vincular su wallet otra vez y un botón a la vinculación (spec 003).
- **Dado** un pago que ya no está `AWAITING_CONFIRMATION` (`409 PAYMENT_NOT_CONFIRMABLE` o al abrir), **cuando** se muestra, **entonces** se redirige al resultado.
- **Dado** "No pagar", **cuando** lo toca, **entonces** el pago se cancela y vuelve al inicio.

## Diseño

### Ruta

`app/(app)/pagos/confirmar/[paymentId].tsx`.

### Datos

Toma el pago de la caché (lo dejó 005 o 008); si no está, `usePayment(paymentId)`.
Respuesta de `POST /payments` (backend 007):
`{ paymentId, status, confirmBy, quote: { debitAmount, receiveAmount, exchangeRate, fee, totalDebit }, allowance: { dailyLimit, availableAfter } }`.

| Fila | Campo de la API |
|---|---|
| Le paga a | Nombre del comercio + `description` |
| Recibe | `quote.receiveAmount` |
| Tasa | `quote.exchangeRate` (solo si las monedas son distintas) |
| Comisión TuTranqui | `quote.fee` (con `percentage`) |
| Total | `quote.totalDebit` |
| Le queda hoy | `allowance.availableAfter` de `allowance.dailyLimit` |
| Vence | `confirmBy` |

### Confirmar

`confirmPayment(paymentId)` en `src/features/payments/confirm.ts`:

1. `POST /payments/{id}/confirm/options` → opciones de WebAuthn + `challengeId`.
2. `getPasskeyAssertion(options)` (módulo del spec 002).
3. `POST /payments/{id}/confirm` `{ challengeId, credential }` con `Idempotency-Key`.
4. `202 { status: "PROCESSING" }` → navegar a `/pagos/resultado/[paymentId]`.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Desglose: misma moneda y monedas distintas; con comisión | Filas exactas con strings; sin `Number` |
| 2 | unit | Texto hablado del resumen con comisión | Frase esperada con montos en palabras |
| 3 | unit | `confirmPayment` con fake de passkeys: éxito, cancelación, cada error | Llamadas en orden; errores traducidos |
| 4 | unit | Cuenta regresiva con reloj falso | Resalta < 60 s; vence en 0 |
| 5 | integration | Confirmación desde la caché y sin caché | Filas correctas; sin caché pide `GET /payments/{id}` |
| 6 | integration | "Sí, pagar" exitoso | `confirm/options` → `confirm`; navega al resultado |
| 7 | integration | `DAILY_LIMIT_EXCEEDED`, `QUOTE_EXPIRED`, `WALLET_LINK_REVOKED` | Mensaje y acción de cada caso |
| 8 | integration | Pago ya `PROCESSING` | Redirige al resultado |
| 9 | integration | "No pagar" | `POST /payments/{id}/cancel`; vuelve al inicio |
| 10 | manual | Pago confirmado en la app contra la red de prueba, sin abrir la wallet | El pago llega a `COMPLETED` |

## Tareas

1. [ ] **Confirmar que el pago sin autorización desde la wallet funciona**: con una wallet vinculada (grant con monto diario, backend 023), hacer varios pagos desde la app sin abrir la wallet y verificar que llegan a `COMPLETED` (caso 10). Si no funciona, avisar para cambiar el front y el back.
2. [ ] Handlers MSW de `POST /payments`, `/payments/{id}/confirm/options`, `/confirm` y `/cancel`.
3. [ ] Casos 1–2 en rojo → desglose y texto hablado.
4. [ ] Casos 3–4 en rojo → `confirmPayment` y cuenta regresiva.
5. [ ] Casos 5–9 en rojo → pantalla de confirmación.
6. [ ] Verificación manual (caso 10) en web.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Aprobación | Una sola vez al vincular la wallet; cada pago se confirma en la app con el passkey (2026-10-16) |
| 2 | Comisión | La devuelve la API en `quote.fee` (backend 024) |
| 3 | Cancelar | `POST /payments/{id}/cancel` al tocar "No pagar" |
| 4 | Un solo cobro | El responsable decidió un único débito por el total (backend [025](../../../backend/docs/specs/025-cobro-unico-comision.md), Borrador). La pantalla no cambia: sigue mostrando comisión y total de `quote`; el usuario ve un solo cargo en su wallet (2026-10-17) |
