# 004 — Persistencia de pagos

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec aprobado; pendiente la autorización para iniciar el desarrollo. Depende del spec 001.

## Contexto

El flujo de pago se parte en dos peticiones (`POST /payments` y el callback) que
en Lambda pueden llegar a instancias distintas, así que el estado del pago debe
guardarse fuera de la memoria. Además, la API necesita un índice de lo que creó
para listar transacciones por wallet. Qué se guarda y por qué está explicado en
[API.md — Dónde vive la información](../API.md#dónde-vive-la-información).

## Alcance

**Incluye**
- Puerto `PaymentsRepository`.
- Implementación en memoria (local y tests) e implementación DynamoDB (Lambda).
- Generación de IDs (`pay_`, `pr_`).
- Diseño de la tabla y sus índices (lo implementa en AWS el spec 002).
- Tests de contrato que corren contra ambas implementaciones.

**No incluye**
- Lógica de negocio de pagos (specs 006–008).
- Registros de idempotencia (spec 005; usan la misma tabla).

## Criterios de aceptación

- **Dado** un pago guardado, **cuando** se lee por su ID, **entonces** se obtiene
  igual a como se guardó.
- **Dado** un cambio de estado con estado esperado, **cuando** el estado actual
  no coincide, **entonces** la actualización falla sin modificar nada (permite
  que el callback se procese una sola vez aunque lleguen dos en paralelo).
- **Dado** varios pagos y solicitudes de una wallet, **cuando** se consultan por
  wallet, **entonces** vuelven del más reciente al más antiguo, paginados con cursor,
  sea la wallet emisora o receptora.
- **Dado** un pago en estado final, **cuando** se guarda, **entonces** ya no
  conserva tokens de Open Payments ni datos de autorización.
- **Dado** las dos implementaciones, **cuando** corren los tests de contrato,
  **entonces** ambas pasan los mismos casos.

## Diseño

### Entidades

| Entidad | ID | Campos |
|---|---|---|
| `PaymentRequest` | `pr_<ulid>` | type, receiverWalletAddress, incomingPaymentUrl, amount, description, status, expiresAt, createdAt, updatedAt |
| `Payment` | `pay_<ulid>` | type, senderWalletAddress, receiverWalletAddress, incomingPaymentUrl, fixedAmountSide, quote (id, debitAmount, receiveAmount, expiresAt), status, authorization*, outgoingPaymentUrl, outgoingToken*, sentAmount, description, error, createdAt, updatedAt, expiresAt* |

`*` Solo mientras el pago no está en estado final. `authorization` = continueUri,
continueToken, clientNonce, finishNonce, authServerUrl.

### Puerto

```ts
interface PaymentsRepository {
  createPayment(p: Payment): Promise<void>
  getPayment(id: string): Promise<Payment | null>
  updatePayment(id: string, changes: Partial<Payment>, opts: { expectedStatus: PaymentStatus }): Promise<Payment>  // lanza ConflictError
  createPaymentRequest(r: PaymentRequest): Promise<void>
  getPaymentRequest(id: string): Promise<PaymentRequest | null>
  listByWallet(q: { walletAddress: string; direction: 'incoming' | 'outgoing' | 'all'; kind: 'payment' | 'payment-request' | 'all'; status?: string; limit: number; cursor?: string }): Promise<{ items: (Payment | PaymentRequest)[]; nextCursor?: string }>
}
```

### Tabla DynamoDB (una sola tabla)

| Atributo | Uso |
|---|---|
| `id` (PK) | `pay_…`, `pr_…`, `idem_…` |
| `senderWalletAddress` + `createdAt` | Índice `bySender` (solo pagos) |
| `receiverWalletAddress` + `createdAt` | Índice `byReceiver` (pagos y solicitudes) |
| `expiresAt` | TTL: solo en pagos pendientes y registros de idempotencia |

- `direction=all` combina ambos índices y ordena por `createdAt`.
- El cursor es opaco (base64 del último elemento de cada índice).
- Actualizaciones con `ConditionExpression` sobre `status`.
- Al pasar a estado final se eliminan `authorization`, `outgoingToken` y `expiresAt`
  (el registro ya no expira: queda como historial).

### IDs

ULID con prefijo, generado con aleatoriedad criptográfica: ordenable por fecha e
impredecible. Motivo en [API.md — Identificadores](../API.md#identificadores).

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Contrato | Crear y leer pago y solicitud | Iguales a lo guardado |
| 2 | Contrato | Leer ID inexistente | `null` |
| 3 | Contrato | `updatePayment` con estado esperado correcto | Actualiza y devuelve el pago |
| 4 | Contrato | `updatePayment` con estado esperado incorrecto | `ConflictError`, sin cambios |
| 5 | Contrato | Dos `updatePayment` concurrentes desde `PENDING_AUTHORIZATION` | Solo uno tiene éxito |
| 6 | Contrato | `listByWallet` por emisor, receptor y `all`, con filtro de estado y tipo | Elementos correctos, orden descendente |
| 7 | Contrato | Paginación con `limit` y `cursor` hasta el final | Sin duplicados ni faltantes; último sin `nextCursor` |
| 8 | Contrato | Pasar a estado final | Sin `authorization`, `outgoingToken` ni `expiresAt` |
| 9 | Unit | Generador de IDs | Prefijo correcto, únicos, ordenables por tiempo |

Los casos de contrato se ejecutan contra memoria siempre y contra DynamoDB Local
con `pnpm test:dynamo` (requiere Docker).

## Tareas

1. [ ] Tipos de dominio `Payment`, `PaymentRequest` y estados.
2. [ ] Generador de IDs: caso 9.
3. [ ] Puerto `PaymentsRepository` y tests de contrato (casos 1–8) en rojo.
4. [ ] Implementación en memoria hasta pasar el contrato.
5. [ ] Implementación DynamoDB hasta pasar el contrato contra DynamoDB Local.
6. [ ] Script `pnpm test:dynamo` y documentación.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Dónde viven las transacciones | Open Payments es la fuente de verdad; DynamoDB guarda el estado del flujo y una copia (índice) de lo que hizo la API, que se refresca al leer pagos no finales (2026-10-16) |
| 2 | Pruebas contra DynamoDB | DynamoDB Local en Docker (aprobado con el spec) |

## Decisiones pendientes

Ninguna.

## Notas

- La tabla la crea el spec 002 con este diseño (índices `bySender` y `byReceiver`).
