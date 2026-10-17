# 008 — Agente por chat

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

El usuario le pide a TuTranqui lo que quiere pagar en sus palabras ("pague la
luz de EPM, son 86.400") y el agente de IA lo resuelve con sus tools: busca el
comercio, prepara el pago y consulta su estado (mockups 3.3 – 3.6). El agente
actúa a nombre del usuario, pero **no puede aprobar**: cuando prepara un pago,
la app muestra una tarjeta de confirmación y el usuario lo aprueba en su wallet
con el mismo flujo de los specs 006 y 007. Este spec es la interfaz de chat; la
voz se agrega en el 009 sobre la misma conversación.

## Alcance

**Incluye**
- Pantalla de chat: burbujas "Usted dijo" / "TuTranqui dice", campo de texto, botón enviar, indicador "escribiendo…".
- Envío de mensajes a `POST /api/v1/agent/messages` y render de la respuesta.
- Render de **acciones** que devuelve el agente:
  - `choose_merchant`: opciones de comercio para que el usuario escoja (el agente no adivina).
  - `confirm_payment`: tarjeta con el resumen del pago y "Revisar y aprobar" → confirmación (006).
  - `payment_status`: tarjeta con el estado de un pago y enlace al detalle.
- Al volver del resultado (007), la conversación muestra la tarjeta de estado del pago.
- Conversación en memoria durante la sesión; se puede empezar una nueva.

**No incluye**
- El agente en sí, su modelo y sus tools (componente `agent/` y spec de backend por escribir).
- Voz (spec 009).
- Historial de conversaciones entre sesiones.
- Respuestas en streaming (decisión pendiente 1).

## Criterios de aceptación

- **Dado** el inicio, **cuando** toca "Toque y dígame qué pagar", **entonces** abre el chat con un saludo y ejemplos ("Pague la luz", "¿Cuánto pagué este mes?").
- **Dado** un mensaje, **cuando** lo envía, **entonces** aparece de inmediato como "Usted dijo", se muestra "escribiendo…" y luego la respuesta del agente.
- **Dado** que el agente devuelve `choose_merchant`, **cuando** se muestra, **entonces** el usuario ve las opciones como botones y, al tocar una, se envía su elección como mensaje.
- **Dado** que el agente devuelve `confirm_payment` con un `paymentId`, **cuando** se muestra, **entonces** ve la tarjeta con comercio, total y "Revisar y aprobar"; al tocarla va a la confirmación (006) de ese pago.
- **Dado** una tarjeta de confirmación, **cuando** el usuario no la toca, **entonces** el pago no se aprueba nunca (la app no abre la wallet por su cuenta).
- **Dado** que el usuario vuelve del resultado (007), **cuando** regresa al chat, **entonces** ve la tarjeta `payment_status` con el estado final.
- **Dado** que el agente tarda más de 30 s o falla, **cuando** ocurre, **entonces** ve "No pude responder. ¿Lo intentamos de nuevo?" con reintento, sin perder el mensaje.
- **Dado** texto del agente con HTML, markdown o enlaces, **cuando** se muestra, **entonces** se muestra como texto plano (no se interpreta ni se abre).
- **Dado** un mensaje vacío o de más de 500 caracteres, **cuando** intenta enviarlo, **entonces** el botón queda deshabilitado o ve el límite.

## Diseño

### Ruta

`app/(app)/agente.tsx`.

### Contrato (propuesto al backend / agente)

```
POST /api/v1/agent/messages
{ "conversationId": "conv_..." | null, "text": "Pague la luz de EPM, son 86.400", "inputMode": "text" | "voice" }

200 {
  "conversationId": "conv_...",
  "reply": { "id": "msg_...", "text": "La factura es de ochenta y seis mil cuatrocientos pesos. ¿Hacemos el pago?" },
  "actions": [
    { "type": "confirm_payment", "paymentId": "pay_01J..." },
    { "type": "choose_merchant", "options": [ { "merchantId": "mer_epm", "label": "EPM · la luz" } ] },
    { "type": "payment_status", "paymentId": "pay_01J..." }
  ]
}
```

- Las tools del agente (definidas del lado del agente) son: buscar comercios,
  crear pago (`POST /payments` con la wallet del usuario en sesión), consultar
  pago y listar transacciones. **No hay tool de aprobación.**
- El agente recibe el token del usuario a través del backend; la app nunca le
  pasa credenciales ni el PIN.
- Para `confirm_payment`, la app pide `GET /payments/{id}` y muestra la tarjeta
  con esos datos (no con el texto del agente): lo que el usuario aprueba es lo
  que dice la API, no lo que dice el modelo.

### Estado

```ts
useAgentConversation(): { messages, send(text, inputMode?), status: "idle" | "sending" | "error", retry, reset }
```

`messages` es una lista de `{ id, role: "user" | "agent", text, actions?, pending? }`
en un reducer testeable. Al volver del 007, el resultado agrega una acción
`payment_status` local si el pago vino del chat.

### Componentes

`ChatScreen`, `UserBubble`, `AgentBubble`, `ChatInput`, `PaymentProposalCard`,
`MerchantChoice`, `PaymentStatusCard`.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Reducer: enviar, respuesta, error, reintento, reset | Mensajes y estados correctos; el mensaje fallido se conserva |
| 2 | unit | Parser de acciones: tipos conocidos, desconocidos, mal formados | Conocidos tipados; el resto se ignora sin romper |
| 3 | component | `AgentBubble` con HTML y enlaces en el texto | Se muestran literales; nada clicable |
| 4 | component | `PaymentProposalCard` con datos de `GET /payments/{id}` | Comercio y total de la API; "Revisar y aprobar" accesible |
| 5 | integration | Conversación: mensaje → respuesta | `POST /agent/messages` con `conversationId` a partir del segundo mensaje |
| 6 | integration | `choose_merchant` → toca opción | Envía la elección como mensaje |
| 7 | integration | `confirm_payment` → "Revisar y aprobar" | Navega a la confirmación (006) con el `paymentId`; nunca abre la wallet sola |
| 8 | integration | Vuelve del resultado | Aparece `PaymentStatusCard` con el estado final |
| 9 | integration | Timeout del agente y reintento | Mensaje de error; reintento reenvía el mismo texto |
| 10 | integration | Validación del campo (vacío, > 500) | No envía |

## Tareas

1. [ ] Handlers MSW de `/agent/messages` con guiones de conversación (pago directo, elegir comercio, error).
2. [ ] Casos 1–2 en rojo → reducer y parser de acciones.
3. [ ] Casos 3–4 en rojo → burbujas y tarjeta de pago.
4. [ ] Casos 5–10 en rojo → pantalla de chat.
5. [ ] Proponer el contrato al backend/agente (spec por escribir) y registrar diferencias.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Streaming de la respuesta** (SSE): se siente más rápido, pero complica
   Lambda + API Gateway. Recomendación: respuesta completa para el hackatón.
2. **Dónde vive el agente:** endpoint del backend que llama al modelo, o
   servicio aparte en `agent/` detrás del backend. Recomendación: la app solo
   habla con el backend (un solo origen, una sola autenticación).
