# Kanban de specs — frontend

> Actualizado: 2026-10-16 · Plan en [PLAN.md](PLAN.md) · Diseño en [DISENO.md](DISENO.md) ·
> Specs del backend en [backend/docs/KANBAN.md](../../backend/docs/KANBAN.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| [001 — Bootstrap del frontend](specs/001-bootstrap-frontend.md) · 0/11 | | | |
| [002 — Inicio de sesión y mi cuenta](specs/002-inicio-sesion.md) · 0/7 | | | |
| [003 — Registro](specs/003-registro.md) · 0/6 | | | |
| [004 — Inicio y transacciones](specs/004-inicio-transacciones.md) · 0/6 | | | |
| [005 — Pago de servicios](specs/005-pago-servicios.md) · 0/6 | | | |
| [006 — Confirmación y aprobación](specs/006-confirmacion-aprobacion.md) · 0/6 | | | |
| [007 — Resultado de la transacción](specs/007-resultado-transaccion.md) · 0/5 | | | |
| [008 — Agente por chat](specs/008-agente-chat.md) · 0/6 | | | |
| [009 — Agente por voz](specs/009-agente-voz.md) · 0/6 | | | |

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
