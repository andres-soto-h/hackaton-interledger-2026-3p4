# 005 — Pago de servicios

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Spec aprobado; pendiente la autorización para iniciar el desarrollo.

## Contexto

El usuario paga un servicio (luz, agua, celular…) a un comercio registrado en
el directorio de TuTranqui. Escoge el comercio, escribe la referencia y el
valor de la factura, y la app revisa la wallet del comercio antes de pedir el
pago (mockups 1.6, 2.1 – 2.3). Este spec llega hasta crear el pago; la
confirmación con el passkey es del spec 006.

## Alcance

**Incluye**
- Directorio: lista de comercios con búsqueda por nombre y filtro por categoría.
- Datos del pago: referencia (la etiqueta la define el comercio, p. ej. "Número de contrato"), valor y descripción opcional.
- Validación del comercio (mockups 1.6, 2.2, 2.3): pasos animados con `CheckItem` mientras se verifica la wallet; resultado con lo que se revisó.
- Creación del pago: `POST /api/v1/payments` con `Idempotency-Key`, y navegación a la confirmación (006) con el `paymentId`.

**No incluye**
- Guardar comercios favoritos o cuentas de servicio.
- Consultar el valor de la factura al comercio (el usuario lo escribe).
- Pagos P2P a personas.

## Criterios de aceptación

- **Dado** el directorio, **cuando** escribe "epm", **entonces** ve solo los comercios cuyo nombre coincide (sin distinguir mayúsculas ni tildes).
- **Dado** un comercio, **cuando** lo toca, **entonces** ve el formulario con la etiqueta de referencia del comercio y la moneda del comercio.
- **Dado** un valor `0`, negativo, con letras o con más decimales que la moneda, **cuando** continúa, **entonces** ve el error del campo.
- **Dado** datos válidos, **cuando** toca "Seguir", **entonces** ve la validación del comercio con sus pasos y, al terminar, "Listo, ya revisé. La cuenta de <comercio> es la correcta" y el botón "Seguir con el pago".
- **Dado** que la wallet del comercio no existe o no está permitida, **cuando** se valida, **entonces** ve "No pudimos comprobar la cuenta de <comercio>. No se ha movido ni un peso" y no puede seguir.
- **Dado** "Seguir con el pago", **cuando** lo toca, **entonces** se llama `POST /payments` una sola vez y se navega a la confirmación con el `paymentId`.
- **Dado** un error del backend al crear el pago (`QUOTE_FAILED`, `AMOUNT_EXCEEDS_LIMIT`, `DAILY_LIMIT_EXCEEDED`, `WALLET_NOT_LINKED`, `PAYMENTS_DISABLED`, `OPEN_PAYMENTS_UNAVAILABLE`…), **cuando** ocurre, **entonces** ve un mensaje claro en lenguaje simple y puede corregir o reintentar.
- **Dado** "Parar" en cualquier paso, **cuando** lo toca, **entonces** vuelve al inicio sin crear el pago.

## Diseño

### Rutas

`app/(app)/pagos/index.tsx` (directorio), `app/(app)/pagos/[merchantId]/datos.tsx`,
`app/(app)/pagos/[merchantId]/validacion.tsx`.

### Contratos

Directorio (propuesto al backend):

```
GET /api/v1/merchants?query=&category=
200 { "items": [ { "id": "mer_epm", "name": "EPM", "category": "energia",
                   "walletAddress": "https://ilp.interledger-test.dev/epm",
                   "assetCode": "COP", "assetScale": 2,
                   "referenceLabel": "Número de contrato", "logoUrl": "..." } ] }
```

Validación: `GET /api/v1/wallets/verify?walletAddress=` (propuesto al backend). Los pasos
de la UI se derivan de la respuesta:

| Paso en la UI | Se cumple si |
|---|---|
| "Es el comercio del directorio" | La wallet es la del directorio |
| "La dirección de pago existe" | `exists: true` |
| "La conexión es segura" | La wallet es `https` (lo garantiza el backend) |
| "El dueño es <comercio>" | `publicName` coincide con el nombre del directorio (sin tildes ni mayúsculas) |

Si `publicName` no coincide, se muestra como advertencia (no bloquea): "La
wallet dice ser de <publicName>".

Crear el pago ([backend 007](../../../backend/docs/specs/007-pago-y-autorizacion.md#post-apiv1payments)):

```
POST /api/v1/payments        Idempotency-Key: <uuid generado al entrar a la validación>
{ "type": "p2m", "receiverWalletAddress": <wallet del comercio>,
  "amount": { "value": "86400", "assetCode": "COP" },
  "description": "EPM · contrato 7731" }
→ 201 { paymentId, status: "AWAITING_CONFIRMATION", confirmBy, quote, allowance }
```

El emisor sale de la sesión (la wallet vinculada del usuario, backend 023); el
pago queda esperando la confirmación con passkey (spec 006).

La respuesta se guarda en la caché de TanStack Query con la clave del pago
para que la confirmación (006) la muestre sin otra petición.

### Mensajes de error

`src/features/payments/errors.ts` traduce cada `code` de
[API.md](../../../backend/docs/API.md#errores) a un texto para el usuario.
Un código desconocido muestra "No pudimos preparar el pago. Intente de nuevo"
con el `requestId` en letra pequeña para soporte.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Búsqueda sin tildes ni mayúsculas | "epm", "EPM", "Épm" encuentran EPM |
| 2 | unit | Schema del valor según `assetScale` | Rechaza `0`, negativos, letras, notación científica, decimales de más |
| 3 | unit | Pasos de validación desde la respuesta (existe, no existe, nombre distinto) | Estados `ok`, `error`, `warning` |
| 4 | unit | Mapeo de códigos de error a mensajes; código desconocido | Texto esperado; genérico con `requestId` |
| 5 | integration | Directorio: búsqueda y categoría | Lista filtrada |
| 6 | integration | Datos inválidos | Errores por campo; no navega |
| 7 | integration | Validación exitosa → "Seguir con el pago" | `POST /payments` con body e `Idempotency-Key`; navega a confirmación con `paymentId` |
| 8 | integration | Validación con wallet inexistente | Mensaje de error; sin botón para seguir; sin `POST /payments` |
| 9 | integration | `POST /payments` responde `QUOTE_FAILED` y luego éxito al reintentar | Mensaje; el reintento usa la misma `Idempotency-Key` |
| 10 | integration | "Parar" | Vuelve al inicio; sin `POST /payments` |

## Tareas

1. [ ] Handlers MSW de `/merchants`, `/wallets/verify` y `POST /payments` con fixtures (EPM, Claro, comercio con wallet inválida).
2. [ ] Casos 1–4 en rojo → búsqueda, schema, pasos de validación y mensajes de error.
3. [ ] Casos 5–6 en rojo → directorio y datos del pago.
4. [ ] Casos 7–10 en rojo → validación y creación del pago.
5. [ ] Proponer el contrato del directorio al backend.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Alta de comercios | Lista fija ya creada en una base de datos en Google Cloud; el backend la expone en `GET /merchants` (2026-10-16) |
| 2 | Referencia del servicio | Se envía en `description` (2026-10-16) |

## Decisiones pendientes

1. **Body para pagar a un comercio del directorio:** el backend 007 define
   `p2m` con `incomingPaymentUrl`. Este spec envía `receiverWalletAddress` +
   `amount` (el usuario escribe el valor de la factura). Hay que alinear el
   contrato con el backend: aceptar esta variante para `p2m` o enviar `p2p`.
