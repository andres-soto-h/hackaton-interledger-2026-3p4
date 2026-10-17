# 003 — Integración con Open Payments

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 8 tareas completadas. Spec en borrador, pendiente de aprobación. Depende del spec 001.

## Contexto

Todos los endpoints de pagos hablan con Open Payments. Este spec construye la
capa que lo hace, aislada detrás de una interfaz para que los servicios se
prueben sin red, y las utilidades que todos necesitan: montos, monedas,
validación de URLs de wallet (anti-SSRF) y traducción de errores. Conceptos y
reglas generales en [API.md](../API.md).

## Alcance

**Incluye**
- Puerto `OpenPaymentsGateway` y un fake en memoria para los tests de otros specs.
- Adapter con el SDK `@interledger/open-payments` y el cliente autenticado.
- `shared/money`: conversión decimal ↔ unidad mínima y reglas de monedas.
- `shared/security/assertSafeWalletUrl` (anti-SSRF).
- `toApiError`: errores del SDK y de red → errores de la API.
- Timeouts y reintentos.
- Configuración: `OPEN_PAYMENTS_TIMEOUT_MS`,
  `ALLOWED_WALLET_HOSTS`, `MAX_PAYMENT_AMOUNTS`.

**No incluye**
- Endpoints (specs 006–008).
- Persistencia (spec 004).
- La lógica del flujo de pago y del callback (spec 007).

## Criterios de aceptación

- **Dado** el secreto de Open Payments cargado, **cuando** arranca la app,
  **entonces** se crea un único cliente autenticado con la identidad de la
  wallet de la plataforma, y si el secreto está incompleto la app no arranca.
- **Dado** cualquier llamada del gateway, **cuando** se ejecuta, **entonces** la
  URL de la wallet o del recurso ya pasó por `assertSafeWalletUrl`.
- **Dado** un monto decimal y una moneda, **cuando** se convierte, **entonces**
  el resultado es exacto en ambos sentidos y nunca usa números de punto flotante.
- **Dado** un error de Open Payments o de red, **cuando** lo recibe el gateway,
  **entonces** se convierte en un error de la API del catálogo de [API.md](../API.md#errores)
  y el detalle original solo queda en el log.
- **Dado** una lectura que falla por red, **cuando** se reintenta, **entonces**
  se hacen como máximo 2 reintentos con backoff; las creaciones nunca se reintentan.

## Diseño

### Puerto

```ts
interface OpenPaymentsGateway {
  getWalletAddress(url: string): Promise<WalletAddress>
  createIncomingPayment(input: { wallet: WalletAddress; amount?: Amount; expiresAt: Date; description?: string }): Promise<IncomingPayment>
  getIncomingPayment(url: string): Promise<IncomingPayment>
  createQuote(input: { sender: WalletAddress; receiver: string; debitAmount?: Amount }): Promise<Quote>
  requestOutgoingPaymentGrant(input: { sender: WalletAddress; debitAmount: Amount; finishUri: string; clientNonce: string }): Promise<PendingGrant>
  continueGrant(input: { continueUri: string; continueToken: string; interactRef: string }): Promise<GrantResult>
  createOutgoingPayment(input: { sender: WalletAddress; quoteId: string; accessToken: string; description?: string }): Promise<OutgoingPayment>
  getOutgoingPayment(input: { url: string; accessToken: string }): Promise<OutgoingPayment>
  revokeToken(input: { manageUrl: string; accessToken: string }): Promise<void>
}
```

- Los grants no interactivos (`incoming-payment`, `quote`) se piden dentro de
  `createIncomingPayment` y `createQuote`; sus tokens no salen del adapter.
- Los tipos del puerto son propios de la API (no los del SDK), con montos ya en
  formato decimal + moneda.

### Cliente autenticado

- `createAuthenticatedClient({ walletAddressUrl, keyId, privateKey })` una vez
  por instancia con el secreto `open-payments` (wallet de la plataforma).
- La llave privada se convierte a `KeyObject` en memoria; nunca se escribe a disco.
- Los comercios (receptores) no necesitan llaves: se les crea el incoming payment
  con un grant no interactivo.

### Grants que usa el adapter

| Recurso | Tipo | Acciones | Auth server de |
|---|---|---|---|
| `incoming-payment` | No interactivo | `create`, `read` | Receptor |
| `quote` | No interactivo | `create`, `read` | Emisor |
| `outgoing-payment` | Interactivo | `create`, `read` + `limits.debitAmount` + `identifier` | Emisor |

### Montos y monedas

Reglas en [API.md — Montos y monedas](../API.md#montos-y-monedas):
- `toMinorUnits("10.50", 2) → "1050"` y `fromMinorUnits("1050", 2) → "10.50"` con
  aritmética de enteros (`BigInt`).
- `resolveFixedAmount(amount, sender, receiver)` decide si el monto fijo es lo
  que recibe el receptor o lo que sale del emisor, o lanza `ASSET_MISMATCH`.
- `assertWithinLimit(debitAmount)` aplica `MAX_PAYMENT_AMOUNTS` por moneda del
  emisor (`AMOUNT_EXCEEDS_LIMIT` / `CURRENCY_NOT_SUPPORTED`).

### Anti-SSRF (`assertSafeWalletUrl`)

Rechaza con `WALLET_NOT_ALLOWED`: esquema distinto de `https`, host fuera de
`ALLOWED_WALLET_HOSTS`, `localhost`, IPs literales privadas o link-local,
puertos distintos de 443, credenciales en la URL. Acepta `$host/path`
(payment pointer) convirtiéndolo a `https://host/path`.

### Errores

`toApiError` (catálogo en [API.md](../API.md#errores)):

| Origen | Error de la API |
|---|---|
| `404` al obtener una wallet | `WALLET_NOT_FOUND` |
| Error al crear un quote (`400`/`422` de Open Payments) | `QUOTE_FAILED` |
| Timeout | `OPEN_PAYMENTS_TIMEOUT` |
| Error de red (DNS, conexión rechazada) | `OPEN_PAYMENTS_UNAVAILABLE` |
| Cualquier otro error del SDK | `OPEN_PAYMENTS_ERROR` |

### Timeouts y reintentos

- `OPEN_PAYMENTS_TIMEOUT_MS` (8000) por llamada.
- Hasta 2 reintentos con backoff solo en `getWalletAddress`, `getIncomingPayment`
  y `getOutgoingPayment`.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Unit | `toMinorUnits` / `fromMinorUnits` con scales 0, 2 y 9 | Conversión exacta en ambos sentidos |
| 2 | Unit | Montos inválidos: `"0"`, `"-1"`, `"1.234"` (scale 2), `"1e3"`, `"abc"`, `""` | Rechazados |
| 3 | Unit | `resolveFixedAmount`: moneda del receptor, solo del emisor, ninguna, ambas iguales | Recibe / envía / `ASSET_MISMATCH` / recibe |
| 4 | Unit | `assertWithinLimit` dentro, sobre el límite y moneda sin límite | Acepta / `AMOUNT_EXCEEDS_LIMIT` / `CURRENCY_NOT_SUPPORTED` |
| 5 | Unit | `assertSafeWalletUrl` rechaza http, host no permitido, `localhost`, `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, puerto 8443, `user:pass@` | `WALLET_NOT_ALLOWED` |
| 6 | Unit | `assertSafeWalletUrl` acepta `https://ilp.interledger-test.dev/x` y `$ilp.interledger-test.dev/x` | URL https normalizada |
| 7 | Unit | `toApiError` para cada fila de la tabla de errores | Código y status esperados; detalle no expuesto |
| 8 | Unit | Secreto de Open Payments sin `walletAddressUrl`, `keyId` o `privateKey`, o con una llave inválida | La app no arranca |
| 9 | Adapter | Cada método del gateway contra fixtures HTTP de Open Payments (msw) | Petición correcta (URL, grant, cuerpo) y respuesta mapeada a tipos propios |
| 10 | Adapter | El grant de outgoing payment lleva `limits.debitAmount`, `identifier`, `interact.finish.uri` y `nonce` | Cuerpo exacto |
| 11 | Adapter | Timeout en una llamada | `OPEN_PAYMENTS_TIMEOUT` |
| 12 | Adapter | Lectura que falla por red dos veces y luego responde | Éxito al tercer intento |
| 13 | Adapter | Creación que falla por red | Sin reintento; `OPEN_PAYMENTS_UNAVAILABLE` |
| 14 | Unit | El fake del gateway cumple los mismos contratos básicos que el adapter | Mismos tipos y errores |

## Tareas

1. [ ] Configuración nueva en `config/env.ts` y validación del secreto de Open Payments (caso 8).
2. [ ] `shared/money`: casos 1–4 en rojo → implementación.
3. [ ] `shared/security/assertSafeWalletUrl`: casos 5–6 → implementación.
4. [ ] Puerto `OpenPaymentsGateway`, tipos propios y fake (caso 14).
5. [ ] `toApiError`: caso 7 → implementación.
6. [ ] Fixtures HTTP de Open Payments a partir de respuestas reales de la red de prueba.
7. [ ] Adapter del SDK con cliente autenticado, timeouts y reintentos: casos 9–13.
8. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Interceptor HTTP para los tests del adapter.** Recomendación: **msw** (intercepta
   `fetch` sin tocar el SDK).

## Notas

- El ejemplo de `backend/reference/` sirve para comparar el orden de las
  llamadas al SDK, pero no se copia.
- Referencias: [Open Payments](https://openpayments.dev) ·
  [SDK Node](https://github.com/interledger/open-payments/tree/main/packages/open-payments).
