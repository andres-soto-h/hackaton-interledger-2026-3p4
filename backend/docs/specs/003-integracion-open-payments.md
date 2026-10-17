# 003 — Integración con Open Payments

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | 2026-10-16 |
| Finalizado | — |

## Estado

5 / 8 tareas completadas (configuración, llave privada, montos, anti-SSRF, puerto + fake y `toApiError`; 150 tests en verde en la rama `spec/003`, pendiente de integrar). Siguen fixtures, adapter del SDK y suite completa. Desarrollo aprobado el 2026-10-16; se desarrolla en paralelo con los specs 002 y 004 (worker de DeepSeek, rama `spec/003`). Ajustado el 2026-10-16 por el monto diario
preaprobado (spec 023); Cambios aprobados el 2026-10-16. Depende del spec 001.

**Qué cambió respecto a la versión aprobada:** el grant de outgoing payment se
pide con límite diario (`debitAmount` + `interval`) en vez del monto de un quote;
se agregan `rotateToken` y `cancelGrant`; `revokeToken` deja de usarse por pago.

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
- `shared/money`: conversión decimal ↔ unidad mínima y **soporte de distintas
  monedas** (qué monto queda fijo, límites por moneda).
- `shared/security/assertSafeWalletUrl` (anti-SSRF).
- `toApiError`: errores del SDK y de red → errores de la API.
- Timeouts y reintentos.
- Configuración: `OPEN_PAYMENTS_TIMEOUT_MS`, `WALLET_PROVIDER_BASE_URL`,
  `ALLOWED_WALLET_HOSTS`, `MAX_PAYMENT_AMOUNTS`.
- Puerto `SettingsProvider` para la configuración que el panel de administración
  podrá editar (spec 020). Este spec solo implementa la versión que lee del entorno.

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
  requestOutgoingPaymentGrant(input: { sender: WalletAddress; limits: { debitAmount: Amount; interval: string }; finishUri: string; clientNonce: string }): Promise<PendingGrant>
  continueGrant(input: { continueUri: string; continueToken: string; interactRef: string }): Promise<GrantResult>
  createOutgoingPayment(input: { sender: WalletAddress; quoteId: string; accessToken: string; description?: string }): Promise<OutgoingPayment>
  getOutgoingPayment(input: { url: string; accessToken: string }): Promise<OutgoingPayment>
  rotateToken(input: { manageUrl: string; accessToken: string }): Promise<{ accessToken: string; manageUrl: string; expiresAt?: Date }>
  cancelGrant(input: { continueUri: string; continueToken: string }): Promise<void>
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
| `outgoing-payment` | Interactivo, una vez al vincular (spec 023) | `create`, `read` + `limits.debitAmount` + `limits.interval` + `identifier` | Emisor |

### Montos

- `toMinorUnits("10.50", 2) → "1050"` y `fromMinorUnits("1050", 2) → "10.50"` con
  aritmética de enteros (`BigInt`). Formato en [API.md — Montos y monedas](../API.md#montos-y-monedas).

### Soporte de distintas monedas

El emisor y el receptor pueden tener monedas distintas. **La conversión la hacen
ILP y el proveedor de la wallet**: el quote devuelve cuánto se debita al emisor
en su moneda y cuánto recibe el receptor en la suya, con la tasa y las
comisiones incluidas. La API no convierte ni maneja tasas. Lo que sí define:

1. **Qué monto queda fijo.** Si piden "envía 10 USD" a una wallet en MXN, hay que
   saber si los 10 USD son lo que sale o lo que llega.
   `resolveFixedAmount(amount, sender, receiver)` aplica la regla:

   | `amount.assetCode` coincide con | Monto fijo | Cómo se pide a Open Payments |
   |---|---|---|
   | La moneda del receptor | El receptor recibe exactamente ese monto | Incoming payment con `incomingAmount`; el quote calcula el débito |
   | Solo la moneda del emisor | Sale exactamente ese monto del emisor | Incoming payment sin monto; quote con `debitAmount` |
   | Ninguna | — | `ASSET_MISMATCH` |

   Si ambos usan la misma moneda, el monto es lo que recibe el receptor. Una
   solicitud de pago siempre fija lo que recibe el receptor, en su moneda.
2. **Mostrar la conversión antes de aprobar.** La respuesta de `POST /payments`
   incluye ambos montos y la tasa (`exchangeRate = receiveAmount / debitAmount`,
   calculada con enteros y redondeada a 6 decimales solo para mostrar). Lo
   implementa el spec 007; la función `exchangeRate` vive aquí.
3. **La tasa vence con el quote**, normalmente en pocos minutos. El usuario debe
   confirmar el pago antes de que venza el quote; si no, el pago pasa a
   `EXPIRED` y hay que cotizar de nuevo (spec 007).
4. **El límite por pago va por moneda**, porque "1000" no significa lo mismo en
   todas. `MAX_PAYMENT_AMOUNTS` (p. ej. `USD:1000,MXN:20000`) define un máximo
   por moneda del emisor. `assertWithinLimit(debitAmount)` lo aplica al
   `debitAmount` del quote: `AMOUNT_EXCEEDS_LIMIT` si lo supera,
   `CURRENCY_NOT_SUPPORTED` si la moneda no tiene límite configurado.

### Proveedor de wallets

- `WALLET_PROVIDER_BASE_URL` (por defecto `https://ilp.interledger-test.dev`) es
  la URL raíz del proveedor. Su host siempre está permitido; `ALLOWED_WALLET_HOSTS`
  agrega hosts adicionales (opcional).
- Permite recibir un *handle* corto: `alice` → `{WALLET_PROVIDER_BASE_URL}/alice`.
- Se lee a través de `SettingsProvider`, igual que `ALLOWED_WALLET_HOSTS` y
  `MAX_PAYMENT_AMOUNTS`, para que el panel de administración (spec 020) pueda
  cambiarlos sin redesplegar.

### Anti-SSRF (`assertSafeWalletUrl`)

Rechaza con `WALLET_NOT_ALLOWED`: esquema distinto de `https`, host fuera de
los hosts permitidos (el de `WALLET_PROVIDER_BASE_URL` más `ALLOWED_WALLET_HOSTS`),
`localhost`, IPs literales privadas o link-local, puertos distintos de 443,
credenciales en la URL. Acepta `$host/path` (payment pointer) convirtiéndolo a
`https://host/path`, y un handle sin esquema (`alice`) resolviéndolo contra
`WALLET_PROVIDER_BASE_URL`.

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
| 10 | Adapter | El grant de outgoing payment lleva `limits.debitAmount`, `limits.interval`, `identifier`, `interact.finish.uri` y `nonce`; `rotateToken` y `cancelGrant` llaman a las URLs correctas | Cuerpo y URLs exactos |
| 11 | Adapter | Timeout en una llamada | `OPEN_PAYMENTS_TIMEOUT` |
| 12 | Adapter | Lectura que falla por red dos veces y luego responde | Éxito al tercer intento |
| 13 | Adapter | Creación que falla por red | Sin reintento; `OPEN_PAYMENTS_UNAVAILABLE` |
| 14 | Unit | El fake del gateway cumple los mismos contratos básicos que el adapter | Mismos tipos y errores |
| 15 | Unit | `assertSafeWalletUrl` con handle `alice` y con `WALLET_PROVIDER_BASE_URL` cambiado a otro host | `{base}/alice`; el host nuevo queda permitido y el anterior no |
| 16 | Unit | `exchangeRate` con montos de distinta escala (USD scale 2, MXN scale 2, JPY scale 0) | Tasa exacta, sin punto flotante |

## Tareas

1. [x] Configuración nueva en `config/env.ts` y validación del secreto de Open Payments (caso 8).
2. [x] `shared/money` y soporte de distintas monedas: casos 1–4 y 16 en rojo → implementación.
3. [x] `SettingsProvider` (desde el entorno) y `assertSafeWalletUrl`: casos 5–6 y 15 → implementación.
4. [x] Puerto `OpenPaymentsGateway`, tipos propios y fake (caso 14).
5. [x] `toApiError`: caso 7 → implementación.
6. [ ] Fixtures HTTP de Open Payments a partir de respuestas reales de la red de prueba.
7. [ ] Adapter del SDK con cliente autenticado, timeouts y reintentos: casos 9–13.
8. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Interceptor HTTP para los tests del adapter | msw (aprobado con el spec) |

## Decisiones pendientes

Ninguna.

## Notas

- El ejemplo de `backend/reference/` sirve para comparar el orden de las
  llamadas al SDK, pero no se copia.
- Referencias: [Open Payments](https://openpayments.dev) ·
  [SDK Node](https://github.com/interledger/open-payments/tree/main/packages/open-payments).
