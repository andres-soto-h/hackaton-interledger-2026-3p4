# Kanban de specs — frontend

> Actualizado: 2026-10-17 · Plan en [PLAN.md](PLAN.md) · Diseño en [DISENO.md](DISENO.md) ·
> Specs del backend en [backend/docs/KANBAN.md](../../backend/docs/KANBAN.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| | [001 — Bootstrap del frontend](specs/001-bootstrap-frontend.md) · 0/11 | | |
| | [002 — Inicio de sesión y mi cuenta](specs/002-inicio-sesion.md) · 0/7 | | |
| | [003 — Registro y vinculación de la wallet](specs/003-registro.md) · 0/7 | | |
| | [004 — Inicio y transacciones](specs/004-inicio-transacciones.md) · 0/6 | | |
| | [005 — Pago de servicios](specs/005-pago-servicios.md) · 0/6 · *directorio simulado; solo COP; pendiente del backend: conectar comercios con Google Cloud* | | |
| | [006 — Confirmación del pago](specs/006-confirmacion-aprobacion.md) · 0/7 · *tarea 1: probar el pago sin autorización en la wallet* | | |
| | [007 — Resultado de la transacción](specs/007-resultado-transaccion.md) · 0/4 | | |
| | [008 — Agente por chat](specs/008-agente-chat.md) · 0/6 | | |
| | [009 — Agente por voz](specs/009-agente-voz.md) · 0/3 · *pendiente de definición técnica* | | |

**Orden de desarrollo:** 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009.
Los specs se desarrollan contra la API simulada (MSW); la integración con el
backend real se verifica cuando su endpoint esté **Hecho**.

## Backlog (specs por escribir)

- Pruebas end-to-end en web (Playwright) del flujo de pago completo
- Despliegue de la app web
- "Hablar con una persona" y "Enviar comprobante a un familiar" (mockups 1.5, 1.8)
- Pagos P2P a contactos guardados (mockups 3.x)

## Historial

| Fecha | Spec | Cambio |
|---|---|---|
| 2026-10-16 | — | Plan del frontend y sistema de diseño creados como borrador a partir de los mockups |
| 2026-10-16 | 001–009 | Creados como borrador |
| 2026-10-16 | 001–009 | Renumerados desde 001 (antes 010–018; numeración propia del frontend). Sesión pasa a 002 y registro a 003 para que el orden de desarrollo sea el numérico |
| 2026-10-16 | — | Plan del frontend aprobado con sus decisiones (stack, comisión, carriles independientes, retorno en Android, mockups fuera del repo) |
| 2026-10-16 | 009 | Voz pendiente de definición técnica: SDK de agentes de Gemini y TTS de Google Cloud; impacta 008 |
| 2026-10-16 | 002, 003 | Autenticación con passkeys, sin PIN; el registro incluye vincular la wallet con monto diario (backend 019 y 023) |
| 2026-10-16 | 005–008 | Los pagos se confirman en la app con el passkey, sin aprobar cada pago en la wallet; el 006 suma la tarea de probarlo |
| 2026-10-16 | 004, 005 | Decisiones resueltas: filtro de un estado, datos completos de la transacción desde el backend, comercios en Google Cloud, referencia en `description` |
| 2026-10-16 | 001–009 | Specs aprobados → Aprobado; pendiente autorizar el desarrollo |
| 2026-10-17 | 005 | Decisiones del responsable: pagos a comercios solo en COP; `p2m` con `receiverWalletAddress` + `amount` (backend 026); directorio simulado en el front y tarea pendiente del backend para conectarlo con Google Cloud |
| 2026-10-17 | 003 | Decisiones: no se pide correo; passkeys en Android solo desde Chrome (TD-003) |
| 2026-10-17 | 006 | Nota: cobro único por el total (backend 025, Borrador); la pantalla no cambia |
