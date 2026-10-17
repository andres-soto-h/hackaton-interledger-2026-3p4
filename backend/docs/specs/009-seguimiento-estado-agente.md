# 009 — Seguimiento del estado de un pago por el agente

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 5 tareas completadas. Borrador para revisión; patrón de polling aprobado. Depende del spec 008.

## Contexto

Un pago no termina en la misma petición que lo inicia:

1. El agente llama `POST /payments` y recibe una URL de autorización.
2. El usuario abre esa URL en su wallet y aprueba (o no). Esto puede tardar
   segundos o minutos, y ocurre **fuera** de la conversación con el agente: el
   navegador del usuario vuelve a la API (callback), no al agente.
3. Después de aprobado, ILP mueve los fondos (normalmente segundos).

El agente necesita enterarse de cómo terminó para responderle al usuario
("listo, el pago se completó"). Hay dos formas de hacerlo:

| | Polling (consultar) | Webhook (aviso) |
|---|---|---|
| Cómo | El agente pregunta cada cierto tiempo `GET /payments/{id}` hasta que el estado es final | La API llama a una URL del agente cuando el estado cambia |
| Ventaja | Simple; no requiere que el agente exponga un endpoint; ya existe (spec 008) | Aviso inmediato; menos peticiones |
| Desventaja | Peticiones de más; el agente debe saber cuándo y cuánto preguntar | El agente debe exponer un endpoint público seguro; la API debe reintentar si falla |

Analogía: polling es preguntar cada rato "¿ya llegó mi pedido?"; webhook es
dejar tu número para que te llamen cuando llegue.

**Por qué la API tampoco recibe avisos de Open Payments:** los servidores de
Open Payments solo envían webhooks a la entidad que administra las wallets (el
proveedor), no a clientes como esta API. Por eso la API averigua el estado
consultando el outgoing payment (spec 008). Lo que la API sí sabe al instante
es cuándo el usuario aprobó o rechazó, porque el callback llega a ella.

## Alcance

**Incluye (fase 1: polling)**
- Contrato de polling para el agente: cuándo empezar, cada cuánto preguntar,
  cuándo parar, qué hacer con cada estado.
- Header `Retry-After` en `GET /payments/{id}` con el intervalo sugerido según el estado.
- Campo `isFinal` en la respuesta para que el agente no tenga que conocer la
  lista de estados finales.
- Guía para el equipo del agente (`backend/docs/guia-agente.md`).

**Incluye (fase 2: webhook, diseño — se implementa solo si se aprueba)**
- Registro de una URL de webhook por API key (configuración).
- Envío de `payment.authorized`, `payment.completed`, `payment.failed`,
  `payment.rejected`, `payment.expired`.
- Firma HMAC-SHA256 de cada envío para que el agente verifique que viene de la API.
- Reintentos con backoff si el agente no responde `2xx`.

**No incluye**
- Notificaciones al usuario final (push, email).

## Criterios de aceptación (fase 1)

- **Dado** un pago no final, **cuando** el agente lo consulta, **entonces** la
  respuesta incluye `isFinal: false` y `Retry-After` con el intervalo sugerido.
- **Dado** un pago final, **cuando** se consulta, **entonces** `isFinal: true` y
  sin `Retry-After`.
- **Dado** la guía del agente, **cuando** el equipo del agente la sigue,
  **entonces** sabe qué hacer en cada estado sin leer el código de la API.

## Diseño

### Contrato de polling

| Estado | `Retry-After` | Qué hace el agente |
|---|---|---|
| `PENDING_AUTHORIZATION` | 5 s | Seguir esperando; recordar al usuario que apruebe en su wallet; parar en `authorizationExpiresAt` |
| `PROCESSING` | 2 s | Seguir; normalmente termina en segundos |
| `COMPLETED` | — | Confirmar al usuario con `receiveAmount` |
| `FAILED` | — | Informar el error (`error.code`) y ofrecer reintentar con un pago nuevo |
| `REJECTED` | — | Informar que el usuario no aprobó |
| `EXPIRED` | — | Informar que venció; ofrecer iniciar otro pago |

- El agente debe respetar `Retry-After` y no consultar más rápido.
- Tiempo máximo de seguimiento: hasta `authorizationExpiresAt` + 2 minutos.
- Ante `5xx` o red caída: backoff exponencial (2, 4, 8 s… máx. 30 s).

### Webhook (fase 2)

```
POST <url del agente>
X-Tranqui-Event: payment.completed
X-Tranqui-Signature: t=1729112345,v1=<hex(hmac_sha256(secret, t + "." + body))>

{ "id": "evt_01J...", "type": "payment.completed", "createdAt": "...", "data": { <igual que GET /payments/{id}> } }
```

- `payment.authorized` se envía desde el callback; los estados finales se
  detectan con un proceso que revisa los pagos `PROCESSING` (requiere un
  disparador programado en AWS, impacto en el spec 002).
- El agente responde `2xx` rápido; la API reintenta hasta 5 veces con backoff.
- El agente debe ignorar eventos repetidos (`id`) y rechazar firmas inválidas o
  con `t` de más de 5 minutos.

## Casos de prueba (fase 1)

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | `GET /payments/{id}` en `PENDING_AUTHORIZATION` | `isFinal: false`, `Retry-After: 5` |
| 2 | Integration | `GET /payments/{id}` en `PROCESSING` | `isFinal: false`, `Retry-After: 2` |
| 3 | Integration | `GET /payments/{id}` en cada estado final | `isFinal: true`, sin `Retry-After` |

## Tareas

1. [ ] Casos 1–3 en rojo → `isFinal` y `Retry-After`.
2. [ ] Actualizar `openapi.yaml`.
3. [ ] Guía para el agente (`backend/docs/guia-agente.md`) con ejemplos.
4. [ ] Suite completa en verde, lint y typecheck limpios.
5. [ ] Decidir si se implementa la fase 2 (webhook) como spec propio.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Cómo se entera el agente del resultado | **Polling** (2026-10-16). El webhook (fase 2) queda diseñado para después |

## Decisiones pendientes

Ninguna.
