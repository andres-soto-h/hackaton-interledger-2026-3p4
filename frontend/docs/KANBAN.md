# Kanban de specs — frontend

> Actualizado: 2026-10-16 · Plan en [PLAN.md](PLAN.md) · Diseño en [DISENO.md](DISENO.md) ·
> Specs del backend en [backend/docs/KANBAN.md](../../backend/docs/KANBAN.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| [010 — Bootstrap del frontend](specs/010-bootstrap-frontend.md) · 0/11 | | | |
| [011 — Registro](specs/011-registro.md) · 0/6 | | | |
| [012 — Inicio de sesión y mi cuenta](specs/012-inicio-sesion.md) · 0/7 | | | |
| [013 — Inicio y transacciones](specs/013-inicio-transacciones.md) · 0/6 | | | |
| [014 — Pago de servicios](specs/014-pago-servicios.md) · 0/6 | | | |
| [015 — Confirmación y aprobación](specs/015-confirmacion-aprobacion.md) · 0/6 | | | |
| [016 — Resultado de la transacción](specs/016-resultado-transaccion.md) · 0/5 | | | |
| [017 — Agente por chat](specs/017-agente-chat.md) · 0/6 | | | |
| [018 — Agente por voz](specs/018-agente-voz.md) · 0/6 | | | |

**Orden de desarrollo:** 010 → 012 → 011 → 013 → 014 → 015 → 016 → 017 → 018.
El 012 va antes que el 011 porque el registro usa la sesión. Los specs se desarrollan contra la API simulada (MSW); la integración con el
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
| 2026-10-16 | 010–018 | Creados como borrador |
