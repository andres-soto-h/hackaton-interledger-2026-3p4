# 024 — Comisión por transacción

| Campo | Valor |
|---|---|
| Estado | **Hecho** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | 2026-10-17 |

## Estado

7 / 7 tareas completadas e integradas y cableadas en `develop-andres` (1051 tests, más 105 contra DynamoDB Local, typecheck y lint en verde). La decisión pendiente del orden de cobro / un solo cobro se resuelve con el valor por defecto del spec y queda registrada en [PENDIENTES-RESPONSABLE](../PENDIENTES-RESPONSABLE.md). Depende de
los specs 007, 020 y 023.

## Contexto

La plataforma cobra una comisión por cada pago o transferencia, calculada como
un **porcentaje del monto a pagar**. El porcentaje se configura desde el panel
de administración.

**Cómo se cobra:** un pago de Open Payments va de un emisor a un solo receptor,
así que no se puede "partir" en dos destinos. La comisión se cobra con un
**segundo outgoing payment** desde la wallet del usuario hacia la wallet de la
plataforma (`tranqui-app`, que hasta ahora no recibía fondos). Ambos pagos usan
el mismo grant del monto diario (spec 023).

## Alcance

**Incluye**
- Configuración `feePercentage` en el panel (spec 020).
- Cálculo de la comisión y su presentación en la cotización del pago.
- Cobro de la comisión con un segundo outgoing payment y su seguimiento.
- Comisiones en el panel: total cobrado por moneda y comisiones fallidas.

**No incluye**
- Comisiones distintas por tipo de pago, comercio o monto (todas iguales).
- Facturación o reportes contables.

## Criterios de aceptación

- **Dado** un porcentaje configurado, **cuando** se cotiza un pago, **entonces**
  la respuesta muestra el monto del pago, la comisión, el total a debitar y el
  porcentaje usado.
- **Dado** un pago confirmado, **cuando** se procesa, **entonces** se reserva el
  total (pago + comisión) en el monto diario y se crean los dos outgoing payments.
- **Dado** que el administrador cambia el porcentaje, **cuando** se guarda,
  **entonces** aplica solo a cotizaciones nuevas; los pagos ya cotizados
  conservan el porcentaje con el que se cotizaron.
- **Dado** una comisión que redondeada da cero (monto muy pequeño o porcentaje
  muy bajo), **cuando** se procesa, **entonces** no se crea el segundo pago.
- **Dado** que el pago principal falla, **cuando** ocurre, **entonces** no se
  cobra la comisión y se libera la reserva completa.
- **Dado** que el pago principal se completa y la comisión falla, **cuando**
  ocurre, **entonces** el pago queda `COMPLETED` con `feeStatus: FAILED`, se
  reintenta al refrescar y aparece en el panel.

## Diseño

### Cálculo

- `feePercentage`: decimal entre `0` y `10`, con hasta 3 decimales (p. ej.
  `1.5` = 1,5 %, `0.001` = 0,001 %). Por defecto `FEE_PERCENTAGE` = `0`.
- Base: el `debitAmount` del quote del pago principal (lo que sale del emisor,
  en su moneda).
- `fee = redondear_hacia_arriba(debitAmount × feePercentage / 100)` en la unidad
  mínima de la moneda del emisor, con aritmética de enteros (`BigInt`).
- `totalDebit = debitAmount + fee`. El límite por pago (`MAX_PAYMENT_AMOUNTS`) se
  aplica al `debitAmount`; el monto diario, al `totalDebit`.

Ejemplo: debitAmount `25.07 USD`, 1,5 % → 0,37605 → fee `0.38 USD`; total `25.45 USD`.

### Cotización (`POST /payments`, spec 007)

```json
"quote": {
  "debitAmount": { "value": "25.07", "assetCode": "USD" },
  "receiveAmount": { "value": "430.00", "assetCode": "MXN" },
  "exchangeRate": "17.152",
  "fee": { "value": "0.38", "assetCode": "USD", "percentage": "1.5" },
  "totalDebit": { "value": "25.45", "assetCode": "USD" },
  "expiresAt": "2026-10-16T21:05:00.000Z"
}
```

### Cobro

1. Al confirmar: reservar `totalDebit` (spec 023).
2. Crear el outgoing payment principal (spec 007).
3. Si se creó y `fee > 0`: crear un incoming payment en la wallet de la
   plataforma y un quote con `debitAmount = fee` (monto fijo de salida: el
   usuario paga exactamente la comisión aunque la plataforma tenga otra moneda),
   y el outgoing payment de la comisión con el mismo token.
4. `feeStatus`: `NONE` (comisión 0) · `PENDING` · `PROCESSING` · `COLLECTED` · `FAILED`.
5. Si la comisión falla al crearse: `FAILED`, se libera solo su parte de la
   reserva, y se reintenta una vez cuando se refresca el pago (spec 008) si el
   quote sigue vigente o con un quote nuevo. Tras el reintento fallido queda
   para el panel.

### Panel (spec 020)

- Campo `feePercentage` en la configuración, con validación y historial.
- En el inicio: comisiones cobradas por moneda (últimas 24 h y total) y número
  de comisiones fallidas, con enlace a esos pagos.

### Entidad `Payment` (spec 004)

Campos nuevos: `feePercentage`, `fee`, `totalDebit`, `feeStatus`,
`feeIncomingPaymentUrl`, `feeOutgoingPaymentUrl`.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Unit | `calculateFee` con 0 %, 1,5 %, 0,001 %, 10 %; scales 0, 2 y 9; redondeo hacia arriba | Valores exactos sin punto flotante |
| 2 | Unit | Porcentajes inválidos: `-1`, `10.5`, `1.2345`, `abc` | Rechazados |
| 3 | Integration | Cotización con comisión | `fee`, `totalDebit` y `percentage` en la respuesta |
| 4 | Integration | Confirmar: pago y comisión creados | Dos outgoing payments; reserva = total; `feeStatus: PROCESSING` |
| 5 | Integration | Comisión que redondea a 0 | Un solo outgoing payment; `feeStatus: NONE` |
| 6 | Integration | Falla el pago principal | Sin pago de comisión; reserva liberada completa |
| 7 | Integration | Falla la comisión; luego refresco con éxito / con falla | `COLLECTED` / `FAILED` y visible en el panel |
| 8 | Integration | Cambio de porcentaje entre cotizar y confirmar | Se usa el porcentaje de la cotización |
| 9 | Integration | Total sobre el disponible del día, aunque el pago solo no lo supera | `422 DAILY_LIMIT_EXCEEDED` |
| 10 | Integration | Panel: guardar `feePercentage` válido / inválido; resumen de comisiones | Guardado con historial / error; totales correctos |

## Tareas

1. [x] `calculateFee` y validación del porcentaje: casos 1–2.
2. [x] Configuración `feePercentage` en `SettingsProvider` y en el panel (caso 10).
3. [x] Comisión en la cotización (casos 3 y 8).
4. [x] Cobro con segundo outgoing payment y reserva del total (casos 4–6 y 9).
5. [x] Reintento al refrescar y estado `feeStatus` (caso 7).
6. [x] Resumen de comisiones en el panel; contrato en `openapi.yaml`.
7. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Quién paga la comisión | Quien hace el pago, también al pagar una solicitud; el receptor recibe el monto completo (2026-10-16) |

## Decisiones pendientes

1. **Orden de cobro.** Recomendación: **primero el pago, después la comisión**.
   Si la comisión falla, el usuario igual recibe su servicio y la plataforma
   reintenta (riesgo: comisión no cobrada, visible en el panel). Alternativa:
   comisión primero; si el pago falla después, habría que devolverla, y Open
   Payments no tiene reembolsos automáticos.
2. **¿Un solo cobro en vez de dos?** Open Payments no permite repartir un
   pago entre dos destinos, así que con un solo débito habría que usar a la
   plataforma como intermediaria: el usuario paga el total a la wallet de la
   plataforma y la plataforma le paga al receptor con su propio grant.
   Recomendación: **mantener dos cobros** y mostrarlos en la app como un solo
   total. La intermediación implica custodiar dinero de terceros (implicaciones
   regulatorias), tener saldo en la wallet de la plataforma, el doble de
   llamadas y conversiones, y si el segundo pago falla la plataforma le queda
   debiendo al receptor.
