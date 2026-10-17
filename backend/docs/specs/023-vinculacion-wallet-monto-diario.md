# 023 — Vinculación de wallet y monto diario preaprobado

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

0 / 10 tareas completadas. Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar todos los specs hasta el 024); se desarrolla en la rama `spec/023`. La tarea 1 (spike en la red de prueba) queda como pendiente del responsable en [PENDIENTES-RESPONSABLE](../PENDIENTES-RESPONSABLE.md); el resto se desarrolla con fakes. Depende de
los specs 003, 004, 005 y 019. Requiere cambios de infraestructura en el spec 002.

## Contexto

**Decisión del 2026-10-16 (confirmada con el equipo y con Interledger el
2026-10-17):** el usuario aprueba los pagos **una sola vez**, al registrarse,
con un **monto fijo por día** disponible para gastar. Después la app paga sin
volver a pedir aprobación en la wallet.

**Confirmación de Interledger (2026-10-17):** un grant de `outgoing-payment`
admite límites de gasto (`limits.debitAmount`) y un `interval`; el titular de la
wallet autoriza una sola vez y los pagos dentro del límite proceden sin nuevas
aprobaciones. La guía oficial
[Get an outgoing payment grant for future payments](https://openpayments.dev/guides/outgoing-grant-future-payments/)
usa un intervalo mensual; el mismo patrón sirve para el diario cambiando el
intervalo a `R/<inicio>/P1D`.

Open Payments lo permite con un **grant de outgoing payment con límites**: el
usuario aprueba en su wallet "esta app puede debitar hasta X por día", y la API
recibe un access token que puede usar para varios pagos mientras no supere el
límite del periodo. El token se renueva (*rotate*) cuando vence, y el usuario o
la API pueden revocar el grant en cualquier momento.

Este spec cubre esa aprobación ("vincular la wallet"), el guardado seguro del
token y el control del monto diario. Los pagos que lo usan están en el spec 007.

**Efecto secundario positivo:** como solo el dueño de la wallet puede aprobar el
grant, al vincularla queda verificado que la wallet es del usuario (resuelve
TD-002).

## Alcance

**Incluye**
- Iniciar la vinculación: grant interactivo de `outgoing-payment` con límite
  diario e `identifier` = wallet del usuario.
- Callback de la autorización con todas sus validaciones (se mueven aquí desde
  el spec 007).
- Guardar el access token cifrado y rotarlo cuando vence.
- Control del gasto del periodo (reserva atómica) y consulta del disponible.
- Desvincular (revocar el grant) y volver a vincular.
- Monto diario por moneda, configurable desde el panel (spec 020).

**No incluye**
- Crear pagos (spec 007) ni comisiones (spec 024).
- Cambiar el monto diario de un usuario sin volver a vincular (el grant es fijo).

## Criterios de aceptación

- **Dado** un usuario con sesión y sin wallet vinculada, **cuando** inicia la
  vinculación, **entonces** recibe una URL de autorización con el límite diario
  en la moneda de su wallet, y la vinculación queda `PENDING_AUTHORIZATION`.
- **Dado** que el usuario aprueba en su wallet, **cuando** llega el callback
  válido, **entonces** se continúa el grant, se guarda el token cifrado, la
  vinculación pasa a `ACTIVE`, la wallet queda verificada y el usuario puede pagar.
- **Dado** un callback alterado, repetido, vencido o de una vinculación
  inexistente, **cuando** llega, **entonces** no se guarda ningún token.
- **Dado** que el usuario rechaza, **cuando** llega el callback, **entonces** la
  vinculación pasa a `REJECTED` y puede intentarlo otra vez.
- **Dado** un token vencido o por vencer, **cuando** se va a usar, **entonces**
  se rota una sola vez aunque haya peticiones en paralelo.
- **Dado** un gasto que superaría el disponible del periodo, **cuando** se
  reserva, **entonces** se rechaza con `DAILY_LIMIT_EXCEEDED` sin llamar a Open Payments.
- **Dado** dos pagos en paralelo que juntos superan el disponible, **cuando** se
  reservan, **entonces** solo uno lo logra.
- **Dado** un usuario que desvincula su wallet o borra su cuenta, **cuando**
  termina, **entonces** el grant queda cancelado en Open Payments y el token borrado.

## Diseño

### Flujo

```
App ──POST /api/v1/me/wallet-link──▶ API          (sesión del usuario)
                                     ├─ GET wallet del usuario (moneda y scale)
                                     ├─ grant INTERACTIVO outgoing-payment
                                     │    limits.debitAmount = monto diario de su moneda
                                     │    limits.interval    = R/<inicio>/P1D
                                     │    identifier         = wallet del usuario
                                     └─ guardar WalletLink (PENDING_AUTHORIZATION)
App ◀── 202 { linkId, authorizationUrl, dailyLimit, expiresAt } ─┘

Usuario abre authorizationUrl ──▶ su wallet ──aprueba / rechaza──▶ redirect a
GET /api/v1/auth/callback?linkId&interact_ref&hash
                                     ├─ valida el callback
                                     ├─ continúa el grant → access token + manage URL
                                     ├─ guarda el token cifrado; WalletLink → ACTIVE
                                     └─ redirige a FRONTEND_RESULT_URL (o HTML provisional)
```

### Endpoints

| Método y ruta | Auth | Qué hace |
|---|---|---|
| `POST /api/v1/me/wallet-link` | Sesión | Inicia la vinculación; si ya hay una `ACTIVE`, `409 WALLET_ALREADY_LINKED` |
| `GET /api/v1/me/wallet-link` | Sesión | Estado de la vinculación (`isFinal` y `Retry-After` mientras está pendiente, spec 009) |
| `DELETE /api/v1/me/wallet-link` | Sesión reciente | Cancela el grant y borra el token |
| `GET /api/v1/me/allowance` | Sesión | `{ dailyLimit, spent, available, periodStart, periodEnd }` |
| `GET /api/v1/auth/callback` | Pública | Vuelta desde la wallet |

### Estados de la vinculación

```
PENDING_AUTHORIZATION ──aprobado──▶ ACTIVE ──desvincular / revocado──▶ REVOKED
        ├──rechazado──▶ REJECTED
        └──vencido────▶ EXPIRED
```

`REJECTED`, `EXPIRED` y `REVOKED` son finales; el usuario puede iniciar una
vinculación nueva. Mientras no tenga una `ACTIVE`, `POST /payments` responde
`403 WALLET_NOT_LINKED`.

### Callback (validaciones en orden)

| # | Validación | Si falla |
|---|---|---|
| 1 | La vinculación existe | `LINK_NOT_FOUND` |
| 2 | Está en `PENDING_AUTHORIZATION` | `CALLBACK_ALREADY_USED` |
| 3 | No venció (`LINK_AUTH_TTL_SECONDS`, 10 min) | → `EXPIRED`; `AUTHORIZATION_EXPIRED` |
| 4 | Si `result=grant_rejected` | → `REJECTED` |
| 5 | Vienen `interact_ref` y `hash` | `CALLBACK_INVALID` |
| 6 | `hash` = `base64(sha256(clientNonce \n finishNonce \n interact_ref \n authServerUrl))`, en tiempo constante | `CALLBACK_INVALID`; sin cambios |
| 7 | Tomar la vinculación con actualización condicional (un solo uso) | `CALLBACK_ALREADY_USED` |
| 8 | Continuar el grant y verificar que esté finalizado | `GRANT_NOT_FINALIZED` → `REJECTED` |
| 9 | Los límites concedidos son los pedidos (monto, moneda e intervalo) | `GRANT_LIMITS_MISMATCH` → se cancela el grant |
| — | Éxito | → `ACTIVE`; usuario con `walletVerified = true` |

La respuesta del callback es siempre una redirección a `FRONTEND_RESULT_URL`
(`?linkId=…&status=…`) o la página HTML provisional; nunca a una URL recibida en
la petición. `API_BASE_URL` (para el `finish.uri`) se toma de
`requestContext.domainName` en Lambda y de la variable en local.

### Monto diario

- Configuración `dailySpendLimits` por moneda (p. ej. `USD:200,MXN:4000`),
  editable desde el panel (spec 020). Una moneda sin monto configurado no se
  puede vincular (`CURRENCY_NOT_SUPPORTED`).
- El monto se fija **al vincular** y queda guardado en la vinculación. Si el
  administrador lo cambia, aplica a las vinculaciones nuevas; el usuario puede
  volver a vincular para tomar el nuevo.
- Periodo: un día, de 00:00 a 23:59:59 en la hora de Bogotá
  (`DAILY_LIMIT_TIMEZONE = America/Bogota`, UTC−5, sin horario de verano). El
  `interval` del grant empieza a las 00:00 de Bogotá del día de la vinculación
  (`R/2026-10-16T05:00:00Z/P1D`), así que el tope se renueva cada medianoche de
  Colombia, igual en la API y en Open Payments.

### Control del gasto (reserva)

Open Payments ya impide gastar más del límite, pero la API lleva su propia
cuenta para responder un error claro **antes** de crear el pago y evitar
pagos a medias (pago sí, comisión no):

- Registro `alw_<linkId>_<inicioDelPeriodo>` con `spent` y TTL de 2 días.
- `reserve(linkId, amount)`: suma con `ConditionExpression spent + amount <= dailyLimit`
  (atómico; dos reservas en paralelo no pueden superar el límite).
- `release(linkId, amount)`: devuelve lo reservado si el pago falla o vence.
- El monto reservado es el **total** que se debitará (pago + comisión, spec 024).

### Token: cifrado y rotación

- El access token y la URL de gestión se guardan cifrados con AES-256-GCM. La
  llave es el secreto `token-encryption-key` de Secrets Manager; el `linkId` va
  como dato asociado (un token copiado a otra vinculación no se puede descifrar).
- `getUsableToken(linkId)`: si el token vence en menos de 60 s, lo rota
  (`POST` a la URL de gestión) y guarda el nuevo con actualización condicional
  sobre `tokenVersion`. Si otra instancia rotó primero, usa el que ella guardó.
- Si Open Payments responde `401` al usar el token, se rota una vez y se
  reintenta. Si la rotación falla porque el grant fue revocado desde la wallet,
  la vinculación pasa a `REVOKED` y el pago falla con `WALLET_LINK_REVOKED`.

### Cambios en el puerto `OpenPaymentsGateway` (spec 003)

| Método | Cambio |
|---|---|
| `requestOutgoingPaymentGrant` | Recibe `limits: { debitAmount, interval }` en vez del monto de un quote |
| `rotateToken({ manageUrl, accessToken })` | Nuevo |
| `cancelGrant({ continueUri, continueToken })` | Nuevo |

### Entidad (misma tabla del spec 004)

| Entidad | ID | Campos |
|---|---|---|
| `WalletLink` | `wl_<ulid>` | userId, walletAddress, assetCode, assetScale, dailyLimit, interval, periodTimezone, status, authorization* (continueUri, continueToken, clientNonce, finishNonce, authServerUrl), tokenCiphertext, tokenVersion, tokenExpiresAt, continueUri y continueToken para cancelar, createdAt, authorizedAt, revokedAt |

`*` Solo mientras está `PENDING_AUTHORIZATION`. El usuario guarda el
`activeLinkId`.

### Errores nuevos

| Código | HTTP | Cuándo |
|---|---|---|
| `LINK_NOT_FOUND` | 404 | `linkId` inexistente en el callback |
| `WALLET_NOT_LINKED` | 403 | Pagar sin una vinculación `ACTIVE` |
| `WALLET_ALREADY_LINKED` | 409 | Iniciar vinculación teniendo una `ACTIVE` |
| `DAILY_LIMIT_EXCEEDED` | 422 | El total supera el disponible del día |
| `WALLET_LINK_REVOKED` | 409 | El usuario revocó el permiso desde su wallet |

`CALLBACK_INVALID`, `CALLBACK_ALREADY_USED`, `AUTHORIZATION_EXPIRED`,
`GRANT_NOT_FINALIZED` y `GRANT_LIMITS_MISMATCH` pasan del spec 007 a este.

### Impacto en otros specs

- **002:** secreto `token-encryption-key`; variables `TOKEN_KEY_SECRET_ARN`,
  `DAILY_LIMIT_TIMEZONE`.
- **003:** cambios del puerto (tabla de arriba).
- **007:** los pagos usan el token de la vinculación; ya no hay grant por pago.
- **019:** después de registrarse, el usuario vincula su wallet; TD-002 queda resuelta.
- **020:** configuración `dailySpendLimits`.
- **021:** el detalle del usuario muestra la vinculación y permite revocarla.
- **022:** eventos `wallet_link.*`.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Manual | **Spike:** grant con `debitAmount` + `interval` `R/<inicio>/P1D` en la red de prueba; dos pagos dentro del límite y uno que lo supera; rotar el token; cancelar el grant | Comportamiento documentado; ajustes al diseño si algo difiere |
| 2 | Integration | Iniciar vinculación | `202`; grant pedido con límite, intervalo, `identifier` y nonce exactos; `PENDING_AUTHORIZATION` |
| 3 | Integration | Iniciar con una vinculación `ACTIVE` / moneda sin monto configurado | `409 WALLET_ALREADY_LINKED` / `422 CURRENCY_NOT_SUPPORTED` |
| 4 | Integration | Callback válido | Token guardado cifrado; `ACTIVE`; `walletVerified = true`; redirección |
| 5 | Integration | Hash alterado / callback repetido / dos en paralelo / vencido / inexistente / rechazado | Igual que la tabla de validaciones; nunca se guarda un token |
| 6 | Integration | Límites concedidos distintos a los pedidos | Grant cancelado; `GRANT_LIMITS_MISMATCH` |
| 7 | Unit | Cifrado: ida y vuelta; `linkId` distinto; texto alterado | Recupera el token / falla / falla |
| 8 | Integration | Token por vencer con dos usos en paralelo | Una sola rotación; ambos usan el token nuevo |
| 9 | Integration | `401` al usar el token / rotación rechazada por grant revocado | Rota y reintenta / `REVOKED` y `WALLET_LINK_REVOKED` |
| 10 | Contrato | `reserve` hasta el límite, por encima, en paralelo; `release`; cambio de periodo | Correcto en memoria y DynamoDB |
| 11 | Integration | `GET /me/allowance` con gasto en el periodo | Disponible correcto; límites del periodo en la zona horaria configurada |
| 12 | Integration | Desvincular con sesión reciente / borrar la cuenta | Grant cancelado en Open Payments; token borrado; `REVOKED` |
| 13 | Integration | El token nunca aparece en respuestas, logs ni eventos | Ausente |
| 14 | Unit | Vector conocido del hash del callback | Hash esperado |

## Tareas

1. [ ] Spike en la red de prueba (caso 1) y ajustes al diseño si hace falta.
2. [ ] Cambios del puerto y del adapter de Open Payments (grant con límites, rotar, cancelar).
3. [ ] Cifrado de tokens (caso 7).
4. [ ] Entidad `WalletLink`, repositorio y reservas con tests de contrato (caso 10).
5. [ ] Iniciar vinculación: casos 2–3.
6. [ ] Callback: casos 4–6 y 14.
7. [ ] Rotación del token: casos 8–9.
8. [ ] Disponible, desvincular y cancelación al borrar la cuenta: casos 11–13.
9. [ ] Contrato en `openapi.yaml`.
10. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Aprobación de pagos | Una sola vez al vincular, con monto fijo por día (2026-10-16) |
| 2 | Inicio del día | Medianoche de Bogotá (`America/Bogota`) (2026-10-16) |
| 3 | Tope diario en Open Payments | **Confirmado por Interledger el 2026-10-17:** el grant admite `debitAmount` + `interval` y se autoriza una sola vez. El spike (tarea 1) solo verifica el comportamiento en la red de prueba |

## Decisiones pendientes

1. **Solo si el spike (tarea 1) contradice la confirmación de Interledger** y la
   red de prueba no acepta `interval`: plan B ya acordado, un grant con límite total sin intervalo y
   el control diario solo en la API con la reserva atómica. Es menos seguro,
   porque Open Payments ya no frenaría un gasto diario excesivo si la API
   fallara. Si ocurre, se ajusta este spec y se pide aprobación del cambio.

## Notas

- Referencias: [Grants de Open Payments](https://openpayments.dev/identity/grants/) ·
  [Guía: grant de pago saliente para pagos futuros](https://openpayments.dev/guides/outgoing-grant-future-payments/) ·
  [Objetos del auth server de Rafiki (`limits`)](https://rafiki.dev/apis/auth/objects/).
