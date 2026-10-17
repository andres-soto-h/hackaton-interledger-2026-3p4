# 009 — Seguimiento del estado de un pago (polling)

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 (polling; versión con aprobación en la wallet por pago); cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

0 / 5 tareas completadas. Revisado el 2026-10-16 por el cambio a un monto
diario preaprobado (spec 023); Cambios aprobados el 2026-10-16. Depende de los
specs 008 y 023.

**Qué cambió respecto a la versión aprobada:**
- La espera de la aprobación en la wallet ya no existe en cada pago: después de
  confirmar, el pago solo espera a que ILP mueva los fondos (segundos).
- El polling ahora lo hace la app (y el agente a través de ella) con la sesión
  del usuario, no con la API key.
- Se aplica también a la vinculación de la wallet (`GET /me/wallet-link`), que
  sí espera la aprobación del usuario en su wallet.
- Se quitan los estados `PENDING_AUTHORIZATION` y `REJECTED` del pago y se
  agregan `AWAITING_CONFIRMATION` y `CANCELLED`.

## Contexto

Hay dos esperas en la app:

1. **Vincular la wallet (una vez):** el usuario aprueba el monto diario en su
   wallet. Puede tardar minutos, y el navegador vuelve a la API (callback), no a
   la pantalla que lo estaba esperando.
2. **Cada pago:** después de confirmar, ILP mueve los fondos; normalmente tarda
   segundos.

En ambos casos la app necesita saber cuándo terminó. Se usa **polling**: la app
pregunta cada pocos segundos hasta que el estado es final. La API ayuda con
`Retry-After` (cuánto esperar) e `isFinal` (cuándo dejar de preguntar).

**Por qué la API tampoco recibe avisos de Open Payments:** los servidores de
Open Payments solo envían webhooks a la entidad que administra las wallets (el
proveedor), no a clientes como esta API. Por eso la API averigua el estado
consultando el outgoing payment (spec 008).

## Alcance

**Incluye**
- Header `Retry-After` y campo `isFinal` en `GET /payments/{id}` y en
  `GET /me/wallet-link`.
- Contrato de polling: cuándo empezar, cada cuánto preguntar, cuándo parar.
- Guía para el frontend y el agente (`backend/docs/guia-polling.md`).

**No incluye**
- Webhooks (diseño de fase 2 en las notas; no se implementa).
- Notificaciones al usuario final (push, email).

## Criterios de aceptación

- **Dado** un pago o una vinculación no final, **cuando** se consulta,
  **entonces** la respuesta incluye `isFinal: false` y `Retry-After` con el
  intervalo sugerido.
- **Dado** un pago o una vinculación final, **cuando** se consulta, **entonces**
  `isFinal: true` y sin `Retry-After`.
- **Dado** la guía, **cuando** el equipo del frontend o del agente la sigue,
  **entonces** sabe qué hacer en cada estado sin leer el código de la API.

## Diseño

### Contrato de polling: pago

| Estado | `Retry-After` | Qué hace la app |
|---|---|---|
| `AWAITING_CONFIRMATION` | 5 s | Es el usuario quien debe actuar (confirmar o cancelar); mostrar la cotización y `confirmBy`; dejar de consultar al vencer |
| `PROCESSING` | 2 s | Seguir; normalmente termina en segundos |
| `COMPLETED` | — | Confirmar al usuario con `receiveAmount` |
| `FAILED` | — | Informar el error (`error.code`) y ofrecer reintentar con un pago nuevo |
| `CANCELLED` | — | Nada |
| `EXPIRED` | — | Informar que venció la cotización; ofrecer cotizar de nuevo |

### Contrato de polling: vinculación de la wallet

| Estado | `Retry-After` | Qué hace la app |
|---|---|---|
| `PENDING_AUTHORIZATION` | 5 s | Recordar al usuario que apruebe en su wallet; parar en `expiresAt` |
| `ACTIVE` | — | Mostrar el monto diario y habilitar los pagos |
| `REJECTED` / `EXPIRED` | — | Ofrecer vincular otra vez |
| `REVOKED` | — | Informar que el permiso fue retirado; ofrecer vincular otra vez |

### Reglas generales

- Respetar `Retry-After`; no consultar más rápido.
- Ante `5xx` o red caída: backoff exponencial (2, 4, 8 s… máx. 30 s).
- Tiempo máximo de seguimiento de un pago en `PROCESSING`: 2 minutos; después,
  mostrar "en proceso" y permitir consultar más tarde.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | `GET /payments/{id}` en `AWAITING_CONFIRMATION` / `PROCESSING` | `isFinal: false`; `Retry-After: 5` / `2` |
| 2 | Integration | `GET /payments/{id}` en cada estado final | `isFinal: true`, sin `Retry-After` |
| 3 | Integration | `GET /me/wallet-link` en `PENDING_AUTHORIZATION` / en cada estado final | `Retry-After: 5` / `isFinal: true` sin `Retry-After` |

## Tareas

1. [ ] Casos 1–3 en rojo → `isFinal` y `Retry-After`.
2. [ ] Actualizar `openapi.yaml`.
3. [ ] Guía de polling (`backend/docs/guia-polling.md`) con ejemplos para el frontend y el agente.
4. [ ] Suite completa en verde, lint y typecheck limpios.
5. [ ] Revisar si el webhook (fase 2) hace falta después del hackatón.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Cómo se entera la app del resultado | **Polling** (2026-10-16) |

## Decisiones pendientes

Ninguna.

## Notas

**Webhook (fase 2, no se implementa):** la API llamaría a una URL registrada
cuando cambia un estado, firmando cada envío con HMAC-SHA256
(`X-Tranqui-Signature: t=…,v1=…`), con reintentos y backoff, y el receptor
ignoraría eventos repetidos o con firma vieja. Los estados finales se
detectarían con un proceso programado que revise los pagos `PROCESSING`.
