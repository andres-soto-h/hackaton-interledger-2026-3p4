# API de pagos P2P / P2M — visión general

Documento de referencia compartido por los specs de la API (003 a 009). Define
conceptos, flujos, estados, endpoints, arquitectura, almacenamiento, monedas y
errores. Cada spec implementa una parte y remite aquí en lugar de repetirlo.
Seguridad: [SEGURIDAD.md](SEGURIDAD.md).

## Conceptos de Open Payments

| Concepto | Qué es | Uso en esta API |
|---|---|---|
| **Wallet address** | URL pública de una cuenta (`https://ilp.interledger-test.dev/alice`); expone `assetCode`, `assetScale`, `authServer` y `resourceServer` | Identifica emisor y receptor |
| **Cliente** | Quien llama a Open Payments. Se identifica con su wallet address y firma cada petición (HTTP Message Signatures) con una llave privada Ed25519 registrada en esa wallet | La API es el cliente; usa la llave de la plataforma |
| **Grant (GNAP)** | Permiso que entrega el *authorization server* de una wallet; devuelve un *access token* | Uno por recurso |
| **Grant no interactivo** | Se concede de inmediato | `incoming-payment` y `quote` |
| **Grant interactivo** | El dueño de la wallet debe aprobarlo en su proveedor (redirect) | `outgoing-payment`: el emisor aprueba el débito |
| **Incoming payment** | Cuenta de cobro en la wallet del receptor, con monto esperado opcional y expiración | "Solicitar pago" y destino de todo pago |
| **Quote** | Cotización en la wallet del emisor: cuánto se debita y cuánto recibe el receptor (incluye conversión de moneda y comisiones) | Paso previo al pago; expira |
| **Outgoing payment** | Orden de pago desde la wallet del emisor hacia un incoming payment, sobre ILP | Ejecuta el pago |

### Identidad de la API (cliente Open Payments)

- La API tiene **una sola** identidad de cliente: una wallet de la plataforma
  (`tranqui-app`), sin fondos, que solo sirve para publicar la llave pública
  (`<wallet>/jwks.json`) con la que los servidores verifican las firmas.
- Esa llave identifica a la app, como el `client_id` + secreto de OAuth. **No da
  acceso a fondos de nadie**: todo acceso pasa por un grant.
- Los usuarios y comercios **nunca entregan llaves**. Para recibir solo hace falta
  su wallet address (grant no interactivo); para pagar, el emisor aprueba el
  grant interactivo iniciando sesión en su propio proveedor de wallet.

## Flujos

### Solicitar pago

```
Agente ──POST /payment-requests──▶ API
                                   ├─ GET wallet receptor
                                   ├─ grant no interactivo incoming-payment (auth server receptor)
                                   ├─ crear incoming payment (resource server receptor)
                                   └─ guardar PaymentRequest
Agente ◀── 201 { id, incomingPaymentUrl, amount, expiresAt } ─┘
```

El `incomingPaymentUrl` es el "link de cobro": el pagador lo usa en `POST /payments`.

### Hacer pago

```
Agente ──POST /payments──▶ API
                           ├─ GET wallets emisor y receptor
                           ├─ si no viene incomingPaymentUrl: crear incoming payment en el receptor
                           ├─ grant no interactivo quote + crear quote (wallet emisor)
                           ├─ grant INTERACTIVO outgoing-payment con límite = quote.debitAmount
                           └─ guardar Payment (PENDING_AUTHORIZATION)
Agente ◀── 202 { paymentId, authorizationUrl, quote } ─┘

Usuario emisor abre authorizationUrl ──▶ su wallet ──aprueba / rechaza──▶ redirect a
GET /auth/callback?paymentId&interact_ref&hash
                           ├─ valida el callback
                           ├─ continúa el grant y crea el outgoing payment
                           ├─ Payment → PROCESSING
                           └─ página de resultado (HTML provisional hasta tener frontend)

Agente ──GET /payments/{id}──▶ API ──consulta Open Payments──▶ COMPLETED / FAILED
```

### Estados de un pago

```
PENDING_AUTHORIZATION ──aprobado──▶ PROCESSING ──▶ COMPLETED
        │                               └────────▶ FAILED
        ├──rechazado──▶ REJECTED
        └──TTL / quote vencido──▶ EXPIRED
```

| Estado | Significado |
|---|---|
| `PENDING_AUTHORIZATION` | Quote creado; esperando que el emisor apruebe en su wallet |
| `PROCESSING` | Grant aprobado y outgoing payment creado; ILP moviendo fondos |
| `COMPLETED` | Open Payments reporta enviado el monto completo |
| `FAILED` | Open Payments marcó el outgoing payment como fallido o no se pudo crear |
| `REJECTED` | El emisor rechazó la autorización |
| `EXPIRED` | No se autorizó a tiempo o el quote venció |

Los estados solo avanzan; `COMPLETED`, `FAILED`, `REJECTED` y `EXPIRED` son finales.

## Endpoints

| Método y ruta | Spec | Auth | Qué hace |
|---|---|---|---|
| `GET /health` | 001 | Pública | Verifica que la API esté arriba |
| `POST /api/v1/payment-requests` | 006 | API key | Solicitar pago (crea incoming payment) |
| `POST /api/v1/payments` | 007 | API key | Inicia un pago; devuelve quote y URL de autorización |
| `GET /api/v1/auth/callback` | 007 | Pública | Recibe la autorización del emisor y ejecuta el pago |
| `GET /api/v1/payments/{paymentId}` | 008 | API key | Estado de un pago |
| `GET /api/v1/transactions` | 008 | API key | Pagos y solicitudes de una wallet |
| `POST /api/v1/auth/register/options` · `/verify` | 019 | Pública | Crear cuenta con passkey |
| `POST /api/v1/auth/login/options` · `/verify` | 019 | Pública | Iniciar sesión con passkey |
| `GET /api/v1/me` · `DELETE /api/v1/me` | 019 | Sesión de usuario | Ver o borrar la cuenta |
| `/admin/*` | 020–022 | Sesión de administrador (cookie) | Panel de administración (HTML) |

Contrato detallado: `backend/docs/openapi.yaml` (se construye con cada spec).

## Arquitectura

```
routes ─▶ controller ─▶ service ─▶ puertos (interfaces)
                                     ├─ OpenPaymentsGateway ◀─ adapter del SDK (spec 003)
                                     └─ PaymentsRepository  ◀─ memoria · DynamoDB (spec 004)
```

- **Controllers:** traducen HTTP ↔ servicio, sin lógica de negocio.
- **Services:** orquestan el flujo y dependen solo de interfaces.
- **Adapters:** implementan las interfaces. Solo `integrations/open-payments`
  importa el SDK, así los servicios se prueban sin red.
- Las dependencias se inyectan en `createApp` (spec 001).

## Dónde vive la información

Hay dos fuentes de datos y cada una tiene un papel distinto:

| Dato | Dónde | Por qué |
|---|---|---|
| El dinero: incoming payments, quotes, outgoing payments, montos enviados y recibidos | **Servidores de Open Payments** de cada wallet (fuente de verdad) | Es donde ocurre el pago; la API nunca "decide" si un pago se hizo, lo pregunta |
| Estado del flujo de autorización: nonces, token y URL para continuar el grant, TTL | **DynamoDB** (spec 004) | Open Payments no guarda el estado del cliente; sin esto no se puede completar el callback, que llega en otra invocación de Lambda |
| Índice de lo que hizo la API: qué wallets participaron, montos, estado, URLs de los recursos de Open Payments | **DynamoDB** (spec 004) | Para listar transacciones por wallet sin pedir permisos al dueño de cada wallet |

**Por qué no consultar todo directamente en Open Payments:** para listar los
pagos de una wallet hay que tener un grant de esa wallet, y para los pagos
salientes ese grant es interactivo (el dueño tendría que aprobar cada consulta).
Además, un pago de esta API son varios recursos en Open Payments (incoming
payment, quote, grant, outgoing payment) que hay que relacionar entre sí.

**Cómo se evita que la copia quede desactualizada:** DynamoDB guarda una foto
del pago, y cuando un pago no está en un estado final, la API consulta Open
Payments al leerlo y actualiza la foto. Los estados finales no cambian, así que
no hace falta volver a consultarlos.

### Identificadores

Cada pago y cada solicitud tienen un ID propio de la API (`pay_…`, `pr_…`):

- **El pago existe antes que sus recursos en Open Payments:** el outgoing payment
  se crea recién cuando el emisor aprueba, pero el agente necesita un ID desde
  el primer momento para consultar el estado.
- **Viaja en la URL del callback:** cuando la wallet devuelve al usuario, el
  `paymentId` es lo que permite encontrar el pago pendiente. Debe ser
  impredecible para que nadie pueda adivinar pagos ajenos.
- **Agrupa varios recursos:** un ID corto y estable en vez de varias URLs largas
  de distintos servidores.

Formato: ULID con prefijo (ordenable por fecha, 80 bits aleatorios).

## Montos y monedas

### Formato

- La API recibe y devuelve montos decimales en string con su moneda:
  `{ "value": "10.50", "assetCode": "USD" }`.
- Internamente se convierten a la unidad mínima con el `assetScale` de cada wallet
  (`"10.50"` con scale 2 → `"1050"`), con aritmética de enteros. Nunca `Number`
  ni `parseFloat`.
- Se rechazan: cero, negativos, notación científica y más decimales que el
  `assetScale` de la moneda.

### Pagos entre monedas distintas

Detalle e implementación en el spec 003 ([Soporte de distintas monedas](specs/003-integracion-open-payments.md#soporte-de-distintas-monedas)).

ILP lo resuelve: el proveedor de la wallet del emisor y los conectores hacen la
conversión, y el **quote** la refleja (`debitAmount` en la moneda del emisor,
`receiveAmount` en la del receptor, con comisiones incluidas). La API no
convierte monedas ni maneja tasas. Lo que sí define:

1. **Qué monto queda fijo.** Si alguien dice "envía 10 USD" a una wallet en MXN,
   hay que saber si los 10 USD son lo que sale o lo que llega. La regla:

   | `amount.assetCode` coincide con | Monto fijo | Cómo se pide a Open Payments |
   |---|---|---|
   | La moneda del receptor | Lo que **recibe** el receptor | Incoming payment con `incomingAmount`; el quote calcula el débito |
   | Solo la moneda del emisor | Lo que **sale** del emisor | Incoming payment sin monto; quote con `debitAmount` |
   | Ninguna | — | `ASSET_MISMATCH` |

   Si ambos usan la misma moneda, el monto es lo que recibe el receptor (las
   comisiones las paga el emisor y se ven en el quote). Una solicitud de pago
   (P2M) siempre fija lo que recibe el comercio, en su moneda.
2. **Mostrar la conversión antes de aprobar.** La respuesta de `POST /payments`
   incluye ambos montos y la tasa implícita para que el agente se la muestre al
   usuario.
3. **La tasa vale mientras el quote no venza** (normalmente pocos minutos). Por
   eso el tiempo para autorizar es el menor entre el TTL configurado y la
   expiración del quote.
4. **El límite por pago depende de la moneda.** `MAX_PAYMENT_AMOUNTS` define un
   máximo por moneda del emisor (p. ej. `USD:1000,EUR:900,MXN:20000`) y se
   aplica al `debitAmount`. Una moneda sin límite configurado se rechaza
   (`CURRENCY_NOT_SUPPORTED`).

## Errores

Formato estándar (spec 001):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "requestId": "c0a8...",
    "details": [{ "path": "amount.value", "message": "Too many decimal places" }]
  }
}
```

| Código | HTTP | Cuándo | Spec |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Body o query inválido | 005 |
| `INVALID_JSON` | 400 | JSON mal formado | 001 |
| `CALLBACK_INVALID` | 400 | Falta `interact_ref`/`hash` o el hash no coincide | 007 |
| `PASSKEY_VERIFICATION_FAILED` | 400 | Firma, origen, rpID o contador del passkey inválidos | 019 |
| `CHALLENGE_EXPIRED` | 400 | Challenge o enlace de registro vencido, usado o inexistente | 019, 021 |
| `UNAUTHORIZED` | 401 | API key ausente o inválida | 001 |
| `SESSION_INVALID` | 401 | Sesión ausente, inválida o vencida; cuenta borrada o bloqueada | 019 |
| `REAUTH_REQUIRED` | 401 | Acción sensible con sesión de más de 5 minutos | 019 |
| `NOT_FOUND` | 404 | Ruta inexistente | 001 |
| `PAYMENT_NOT_FOUND` | 404 | `paymentId` inexistente | 007, 008 |
| `IDEMPOTENCY_CONFLICT` | 409 | Misma `Idempotency-Key` con otro body | 005 |
| `CALLBACK_ALREADY_USED` | 409 | El pago ya salió de `PENDING_AUTHORIZATION` | 007 |
| `WALLET_ALREADY_REGISTERED` | 409 | La wallet ya tiene una cuenta | 019 |
| `AUTHORIZATION_EXPIRED` | 410 | Autorización o quote vencidos | 007 |
| `PAYLOAD_TOO_LARGE` | 413 | Body mayor a 16 kb | 005 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-Type distinto de JSON | 005 |
| `WALLET_NOT_FOUND` | 422 | La wallet address no existe | 003 |
| `WALLET_NOT_ALLOWED` | 422 | URL de wallet no permitida (no https, host no permitido, IP privada) | 003 |
| `ASSET_MISMATCH` | 422 | La moneda no es la del emisor ni la del receptor | 003 |
| `CURRENCY_NOT_SUPPORTED` | 422 | Moneda del emisor sin límite configurado | 003 |
| `AMOUNT_EXCEEDS_LIMIT` | 422 | Monto mayor al máximo de su moneda | 003 |
| `INCOMING_PAYMENT_NOT_PAYABLE` | 422 | Incoming payment completado, vencido o sin monto | 007 |
| `QUOTE_FAILED` | 422 | Open Payments no pudo cotizar (sin ruta, sin liquidez, monto muy pequeño) | 003 |
| `GRANT_NOT_FINALIZED` | 502 | El grant no quedó finalizado tras continuar | 007 |
| `GRANT_LIMITS_MISMATCH` | 502 | El límite concedido no cubre el quote | 007 |
| `OPEN_PAYMENTS_ERROR` | 502 | Error de Open Payments no clasificado | 003 |
| `OPEN_PAYMENTS_UNAVAILABLE` | 503 | La wallet o la red no responden | 003 |
| `PAYMENTS_DISABLED` | 503 | Pagos desactivados desde el panel | 020 |
| `OPEN_PAYMENTS_TIMEOUT` | 504 | Se superó el timeout | 003 |
| `INTERNAL_ERROR` | 500 | Cualquier otro error | 001 |

El detalle original de Open Payments va al log, nunca a la respuesta.

## Configuración

Además de la del spec 001:

| Variable | Por defecto | Spec | Descripción |
|---|---|---|---|
| `OPEN_PAYMENTS_TIMEOUT_MS` | `8000` | 003 | Timeout por llamada |
| `WALLET_PROVIDER_BASE_URL` | `https://ilp.interledger-test.dev` | 003 | URL raíz del proveedor de wallets; su host siempre está permitido. Editable desde el panel (spec 020) |
| `ALLOWED_WALLET_HOSTS` | vacío | 003 | Hosts de wallet adicionales. Editable desde el panel (spec 020) |
| `MAX_PAYMENT_AMOUNTS` | `USD:1000` | 003 | Máximo por pago por moneda del emisor. Editable desde el panel (spec 020) |
| `PAYMENTS_TABLE_NAME` | — | 004 | Tabla DynamoDB (solo Lambda) |
| `CORS_ALLOWED_ORIGINS` | vacío | 005 | Orígenes permitidos (vacío = CORS deshabilitado) |
| `API_BASE_URL` | — (obligatoria) | 007 | URL pública de la API; base del `finish.uri` |
| `FRONTEND_RESULT_URL` | — | 007 | Página de resultado; sin valor se muestra el HTML provisional |
| `PAYMENT_AUTH_TTL_SECONDS` | `600` | 007 | Tiempo máximo para autorizar un pago. Editable desde el panel (spec 020) |
| `SESSION_SECRET_ARN` | — | 019 | Secreto de firma de sesiones (en local, `SESSION_SECRET`) |
| `SESSION_TTL_SECONDS` | `3600` | 019 | Duración de la sesión de usuario |
| `WEBAUTHN_RP_ID` | `localhost` | 019 | Dominio del frontend al que quedan atados los passkeys |
| `WEBAUTHN_ORIGINS` | `http://localhost:8081` | 019 | Orígenes exactos desde los que se aceptan passkeys |
| `ADMIN_ENABLED` | `true` en `dev` | 020 | Activa el panel `/admin` |
| `ADMIN_PASSWORD_SECRET_ARN` | — | 020 | Clave del administrador (en local, `ADMIN_PASSWORD`) |
| `ADMIN_SESSION_TTL_SECONDS` | `28800` | 020 | Duración de la sesión del administrador |
