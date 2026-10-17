# 006 — Confirmación y aprobación del pago

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

Antes de que se mueva un peso, el usuario ve exactamente cuánto paga, a quién y
desde dónde (mockups 1.7, 2.4, 3.5: "Revisar y decir sí"). Si está de acuerdo,
la app lo lleva a **su wallet** para aprobar el débito (grant interactivo de
Open Payments, mockup 1.3). La app y el agente nunca aprueban: solo el usuario,
en su proveedor de wallet ([PLAN.md](../PLAN.md#seguridad)). La misma pantalla
la usan los pagos manuales (005) y los que prepara el agente (008).

## Alcance

**Incluye**
- Pantalla de confirmación del pago a partir de la respuesta de `POST /payments` (o de `GET /payments/{id}` si se abre de nuevo).
- Desglose: le paga a, valor que recibe el comercio, costo del pago (comisiones del quote), sale de (wallet del usuario), total que sale; tasa de cambio si las monedas son distintas.
- Mensaje hablado del resumen (texto accesible con `toSpokenAmount`; lo lee la voz en 009).
- Cuenta regresiva hasta que vence la autorización; al vencer se deshabilita "Sí, pagar".
- "Sí, pagar": abre la `authorizationUrl` en la wallet (web: misma pestaña; Android: `expo-web-browser`).
- "Repítamelo" (vuelve a anunciar el resumen) y "No pagar" (vuelve al inicio; el pago queda pendiente y vence solo).

**No incluye**
- El resultado después de aprobar (spec 007).
- Cancelar el pago en el backend (no existe endpoint; vence por TTL).
- Comisión propia de TuTranqui (decisión pendiente 2 del [PLAN](../PLAN.md#decisiones-pendientes)).

## Criterios de aceptación

- **Dado** un pago `PENDING_AUTHORIZATION`, **cuando** abre la confirmación, **entonces** ve el comercio, el valor que recibe, el costo del pago, la wallet de origen y el total que sale, todos con su moneda.
- **Dado** `debitAmount` en COP y `receiveAmount` en USD, **cuando** se muestra, **entonces** también ve la tasa ("Dólar de hoy $3.950") calculada sin `Number` y con aviso de que vale hasta que vence.
- **Dado** el lector de pantalla, **cuando** entra, **entonces** se anuncia "La factura es de ochenta y seis mil cuatrocientos pesos… ¿Hacemos el pago?".
- **Dado** "Sí, pagar" en web, **cuando** lo toca, **entonces** el navegador va a la `authorizationUrl` (solo si es `https`).
- **Dado** "Sí, pagar" en Android, **cuando** lo toca, **entonces** se abre la wallet en el navegador del sistema y, al cerrarse, la app va al resultado (007) con el `paymentId`.
- **Dado** que faltan menos de 60 s, **cuando** se muestra, **entonces** la cuenta regresiva se resalta; al llegar a 0, "Sí, pagar" queda deshabilitado y ve "Se venció el tiempo. Prepare el pago otra vez".
- **Dado** un pago que ya no está `PENDING_AUTHORIZATION`, **cuando** abre la confirmación (p. ej. con el botón atrás), **entonces** se redirige al resultado.
- **Dado** "No pagar", **cuando** lo toca, **entonces** vuelve al inicio y no se abre la wallet.

## Diseño

### Ruta

`app/(app)/pagos/confirmar/[paymentId].tsx`.

### Datos

Toma el pago de la caché (lo dejó 005 o 008); si no está, `usePayment(paymentId)`.

| Fila | Campo de la API |
|---|---|
| Le paga a | Nombre del comercio + `description` |
| Recibe | `quote.receiveAmount` |
| Costo del pago | `quote.debitAmount − quote.receiveAmount` si son de la misma moneda; si no, no se muestra por separado |
| Tasa | `debitAmount / receiveAmount` con aritmética de enteros (unidad mínima) |
| Sale de | Wallet del usuario (sesión) |
| Total | `quote.debitAmount` |
| Vence | `min(quote.expiresAt, authorizationExpiresAt)` (lo que devuelva el backend 007) |

### Abrir la wallet

`openAuthorization(url, paymentId)` en `src/features/payments/authorization.ts`,
con implementación por plataforma:

- **Web:** `window.location.assign(url)`. El backend vuelve a
  `FRONTEND_RESULT_URL` (`https://<app>/pagos/resultado`) con `paymentId` y `status`.
- **Android:** `WebBrowser.openAuthSessionAsync(url, <FRONTEND_RESULT_URL>)`;
  al cerrarse (por redirect o porque el usuario volvió), navega a
  `/pagos/resultado?paymentId=…` y el 007 consulta el estado por polling
  (decisión pendiente 4 del [PLAN](../PLAN.md#decisiones-pendientes)).
- Rechaza URLs que no sean `https`.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Desglose: misma moneda (costo = débito − recibido) y monedas distintas (tasa) | Valores exactos con strings; sin `Number` |
| 2 | unit | Texto hablado del resumen | Frase esperada con montos en palabras |
| 3 | unit | `openAuthorization` web / Android (mocks de `window.location` y `expo-web-browser`); URL `http` | Llama a la API de la plataforma; `http` rechazada |
| 4 | unit | Cuenta regresiva con reloj falso | Resalta < 60 s; vence en 0 |
| 5 | integration | Confirmación desde la caché | Filas correctas sin petición extra |
| 6 | integration | Confirmación sin caché | `GET /payments/{id}` y mismas filas |
| 7 | integration | "Sí, pagar" | `openAuthorization` con la URL del pago |
| 8 | integration | Vencimiento | Botón deshabilitado y mensaje |
| 9 | integration | Pago ya `PROCESSING` | Redirige al resultado |
| 10 | integration | "No pagar" | Vuelve al inicio; no abre la wallet |
| 11 | manual | Web y Android contra la red de prueba: aprobar en la wallet | Vuelve a la app con el resultado |

## Tareas

1. [ ] Casos 1–2 en rojo → desglose y texto hablado.
2. [ ] Caso 3 en rojo → `openAuthorization` por plataforma.
3. [ ] Caso 4 en rojo → hook de cuenta regresiva.
4. [ ] Casos 5–10 en rojo → pantalla de confirmación.
5. [ ] Verificación manual (caso 11) cuando el backend 007 esté desplegado.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **`authorizationUrl` en `GET /payments/{id}`:** para abrir la confirmación
   sin caché (caso 6) el backend debe devolverla mientras el pago esté
   `PENDING_AUTHORIZATION`. Hay que confirmarlo en el backend 008.
2. **Cancelar un pago pendiente:** hoy vence solo. ¿Se agrega
   `POST /payments/{id}/cancel`? Recomendación: no para el hackatón.
