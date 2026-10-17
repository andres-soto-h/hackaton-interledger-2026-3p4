# Guía de polling: seguir el estado de un pago o de una vinculación

Esta guía describe el contrato de polling de la API (spec 009) para el frontend
y para el agente. No hace falta leer el código de la API: con lo que hay aquí se
sabe cuándo empezar a preguntar, cada cuánto, cuándo parar y qué hacer en cada
estado.

## Cuándo empezar

- **Pago:** después de `POST /api/v1/payments/{id}/confirm` (respuesta `202` con
  `status: PROCESSING`). No hace falta esperar la aprobación en la wallet: el
  pago solo espera a que ILP mueva los fondos.
- **Vinculación:** después de `POST /api/v1/me/wallet-link` (respuesta `202` con
  `authorizationUrl`). El usuario debe aprobar el monto diario en su wallet; el
  navegador vuelve a la API por el callback, no a la pantalla que espera.

En ambos casos se consulta con la **sesión del usuario** (`Authorization: Bearer
<token>`), no con la API key.

## Cada cuánto preguntar

La respuesta incluye el header **`Retry-After`** con los segundos que conviene
esperar antes de la siguiente consulta. Respétalo y no consultes más rápido:

| Recurso | `Retry-After` |
|---|---|
| Pago en `AWAITING_CONFIRMATION` | `5` s |
| Pago en `PROCESSING` | `2` s |
| Vinculación pendiente (`PENDING_AUTHORIZATION`) | `5` s |
| Cualquier estado final | ausente |

Ante `5xx` o un fallo de red usa **backoff exponencial**: 2, 4, 8, 16, 32 s…
con un máximo de **30 s** entre intentos. No cuentes un `5xx` como estado del
pago: vuelve a preguntar.

## Cuándo parar

El cuerpo de la respuesta incluye **`isFinal`** (boolean). Cuando sea `true`, el
estado ya no va a cambiar: deja de consultar y muestra el resultado.

- `GET /api/v1/payments/{id}` → `isFinal: true` en `COMPLETED`, `FAILED`,
  `CANCELLED` y `EXPIRED`.
- `GET /api/v1/me/wallet-link` → `isFinal: true` en `ACTIVE`, `REJECTED`,
  `EXPIRED` y `REVOKED`.

Mientras `isFinal` sea `false`, sigue consultando. `feeStatus` (comisión) es
independiente: `PENDING` no significa que el pago no haya terminado; guíate solo
por `isFinal` y `status`.

## Estados del pago

| Estado | `Retry-After` | Qué hace la app |
|---|---|---|
| `AWAITING_CONFIRMATION` | 5 s | Es el usuario quien debe actuar (confirmar o cancelar); mostrar la cotización y `confirmBy`; dejar de consultar al vencer |
| `PROCESSING` | 2 s | Seguir; normalmente termina en segundos |
| `COMPLETED` | — | Confirmar al usuario con `receiveAmount` |
| `FAILED` | — | Informar el error (`error.code`) y ofrecer reintentar con un pago nuevo |
| `CANCELLED` | — | Nada |
| `EXPIRED` | — | Informar que venció la cotización; ofrecer cotizar de nuevo |

## Estados de la vinculación de la wallet

| Estado | `Retry-After` | Qué hace la app |
|---|---|---|
| `PENDING_AUTHORIZATION` | 5 s | Recordar al usuario que apruebe en su wallet; parar en `expiresAt` |
| `ACTIVE` | — | Mostrar el monto diario y habilitar los pagos |
| `REJECTED` / `EXPIRED` | — | Ofrecer vincular otra vez |
| `REVOKED` | — | Informar que el permiso fue retirado; ofrecer vincular otra vez |

## Reglas generales

- Respeta `Retry-After`; no consultes más rápido.
- Ante `5xx` o red caída: backoff exponencial (2, 4, 8 s… máx. 30 s).
- Tiempo máximo de seguimiento de un pago en `PROCESSING`: **2 minutos**.
  Después, muestra "en proceso" y permite consultar más tarde.
- `401` significa sesión inválida o vencida: no reintentes en bucle; pide volver
  a iniciar sesión.

## Ejemplo para el frontend (TypeScript)

```ts
interface PaymentStatusBody {
  paymentId: string
  status: 'AWAITING_CONFIRMATION' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED'
  isFinal: boolean
  receiveAmount: { value: string; assetCode: string }
  error: { code: string; message: string } | null
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function pollPayment(
  paymentId: string,
  token: string,
  onStatus?: (body: PaymentStatusBody) => void
): Promise<PaymentStatusBody> {
  const deadline = Date.now() + 2 * 60_000 // máx. 2 min en PROCESSING
  let backoffMs = 2_000

  for (;;) {
    let res: Response
    try {
      res = await fetch(`/api/v1/payments/${paymentId}`, {
        headers: { authorization: `Bearer ${token}` }
      })
    } catch {
      // Red caída: backoff exponencial.
      await sleep(backoffMs)
      backoffMs = Math.min(backoffMs * 2, 30_000)
      continue
    }

    if (res.status >= 500) {
      await sleep(backoffMs)
      backoffMs = Math.min(backoffMs * 2, 30_000)
      continue
    }
    if (res.status === 401) throw new Error('SESSION_INVALID')

    backoffMs = 2_000
    const body = (await res.json()) as PaymentStatusBody
    onStatus?.(body)

    if (body.isFinal) return body
    if (body.status === 'PROCESSING' && Date.now() > deadline) return body

    const retryAfterSeconds = Number(res.headers.get('Retry-After') ?? '2')
    await sleep(retryAfterSeconds * 1_000)
  }
}
```

Para la vinculación es el mismo bucle contra `GET /api/v1/me/wallet-link`,
mostrando el recordatorio de aprobación mientras `status` sea
`PENDING_AUTHORIZATION`.

## Ejemplo para el agente

El agente no consulta la API directamente: usa la sesión del usuario a través de
la app. Cuando la app confirme un pago, espera su resultado con el mismo contrato:

```ts
type PaymentOutcome =
  | { ok: true; status: 'COMPLETED'; receiveAmount: { value: string; assetCode: string } }
  | { ok: false; status: 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'AWAITING_CONFIRMATION'; code?: string }

/**
 * `pollPayment` es el del ejemplo anterior (respeta Retry-After, `isFinal` y el
 * límite de 2 minutos).
 */
async function awaitPayment(
  paymentId: string,
  token: string
): Promise<PaymentOutcome> {
  const final = await pollPayment(paymentId, token)

  if (final.status === 'COMPLETED') {
    return { ok: true, status: 'COMPLETED', receiveAmount: final.receiveAmount }
  }
  if (final.status === 'FAILED' && final.error !== null) {
    return { ok: false, status: 'FAILED', code: final.error.code }
  }
  if (final.status === 'CANCELLED' || final.status === 'EXPIRED') {
    return { ok: false, status: final.status }
  }
  // Sigue PROCESSING tras los 2 minutos: informa "en proceso" y consulta más tarde.
  return { ok: false, status: 'AWAITING_CONFIRMATION' }
}
```

Recomendaciones para el agente:

- Un solo bucle de polling por pago; no lances consultas en paralelo.
- No reintentes ante `4xx` (salvo que el usuario actúe): informa y para.
- Si el pago sigue `PROCESSING` tras 2 minutos, informa que está "en proceso" y
  guarda el `paymentId` para consultarlo más tarde.
