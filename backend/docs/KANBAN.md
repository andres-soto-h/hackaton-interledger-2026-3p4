# Kanban de specs

> Actualizado: 2026-10-16 · Flujo y reglas en [PLAN.md](PLAN.md#flujo-de-trabajo-sdd--tdd) ·
> Visión de la API en [API.md](API.md) · [Seguridad](SEGURIDAD.md) · [Deuda técnica](DEUDA-TECNICA.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| [003 — Integración con Open Payments](specs/003-integracion-open-payments.md) · 0/8 | [001 — Bootstrap de la API](specs/001-bootstrap-api.md) · 0/14 · *pendiente autorizar desarrollo* | [002 — Infraestructura AWS Lambda](specs/002-infraestructura-aws-lambda.md) · 9/20 · *despliegue bloqueado por 001* | |
| [004 — Persistencia de pagos](specs/004-persistencia-pagos.md) · 0/7 | | | |
| [005 — Middlewares HTTP](specs/005-middlewares-http.md) · 0/7 | | | |
| [006 — Solicitar pago](specs/006-solicitar-pago.md) · 0/5 | | | |
| [007 — Hacer pago y autorización](specs/007-pago-y-autorizacion.md) · 0/7 | | | |
| [008 — Consulta de pagos y transacciones](specs/008-consulta-pagos-transacciones.md) · 0/6 | | | |
| [009 — Seguimiento del estado por el agente](specs/009-seguimiento-estado-agente.md) · 0/5 · *polling aprobado* | | | |
| [019 — Cuentas de usuario con passkeys](specs/019-cuentas-usuario-passkeys.md) · 0/9 | | | |
| [020 — Panel admin: base y configuración](specs/020-panel-admin-configuracion.md) · 0/9 | | | |
| [021 — Panel admin: gestión de usuarios](specs/021-panel-admin-usuarios.md) · 0/7 | | | |
| [022 — Panel admin: actividad en vivo](specs/022-panel-admin-actividad.md) · 0/6 | | | |

**Orden de desarrollo:** 001 → (003, 004) → 005 → 006 → 007 → 008 → 009 → 019 → 020 → 021 → 022.
El 019 y el 020 solo dependen de 003–005; pueden adelantarse si la demo lo necesita.
El despliegue del 002 se puede hacer al terminar el 001.

## Backlog (specs por escribir)

- Webhooks hacia el agente (fase 2 del spec 009, si se aprueba)
- Seguridad como spec propio (si [SEGURIDAD.md](SEGURIDAD.md) lo amerita)
- Pedidos por el frontend ([contratos propuestos](../../frontend/docs/PLAN.md#dependencias-con-el-backend)):
  - Usuarios y sesiones: registro, ingreso con correo + PIN, usuario actual, eliminar cuenta y token de sesión en vez de API key para la app
  - Directorio de comercios — `GET /api/v1/merchants`
  - Verificación de wallet — `GET /api/v1/wallets/verify`
  - Transacciones del usuario en sesión (ajuste al 008) y `authorizationUrl` en `GET /payments/{id}` mientras esté pendiente
  - API del agente — `POST /api/v1/agent/messages` con tools sin permiso de aprobar

## Historial

| Fecha | Spec | Cambio |
|---|---|---|
| 2026-10-16 | 001 | Creado como borrador (infraestructura) |
| 2026-10-16 | 001 | Agregada autenticación por API key y tarea de evaluar JWT |
| 2026-10-16 | 001 | Spec aprobado → Aprobado |
| 2026-10-16 | 001 | Desarrollo aprobado → En desarrollo |
| 2026-10-16 | 001 | Plantilla IaC completa (tareas 3–9), 10/10 tests en verde |
| 2026-10-16 | 002 | Infraestructura renumerada de 001 a 002; sigue En desarrollo, bloqueada por 001 para desplegar |
| 2026-10-16 | 001 | Bootstrap de la API creado como borrador; recibe las tareas de cargador de secretos y middleware de API key desde 002 |
| 2026-10-16 | 001 | Spec aprobado → Aprobado (serverless-http, Zod, pino, esbuild) |
| 2026-10-16 | 002 | Aprobados cambios: tabla de pagos con índices, throttling, configuración y alarmas; evaluación de JWT → deuda técnica TD-001 |
| 2026-10-16 | 003–009 | Spec de la API dividido en 7 specs; creados como borrador con [API.md](API.md) y [SEGURIDAD.md](SEGURIDAD.md) como referencia común |
| 2026-10-16 | 002 | Llaves de comercios ficticios → una sola identidad de cliente (wallet de la plataforma); formato del secreto simplificado (impacta 001 y 003) |
| 2026-10-16 | — | Backlog: endpoints que pide el frontend (usuarios, directorio, verificación de wallet, agente) |
| 2026-10-16 | 003 | Agregada la sección *Soporte de distintas monedas* y la URL del proveedor de wallets configurable |
| 2026-10-16 | 004, 009 | Decisiones aprobadas: copia de transacciones en DynamoDB; seguimiento por polling |
| 2026-10-16 | 019 | Cuentas de usuario con passkeys creado como borrador; deuda técnica TD-002 a TD-004 |
| 2026-10-16 | 020–022 | Panel de administración creado como borrador, dividido en tres specs; deuda técnica TD-005 |
| 2026-10-16 | 002 | Agregadas tareas 17–20 de infraestructura requeridas por los specs 019–022 (se implementan cuando esos specs se aprueben) |
| 2026-10-16 | 019–022 | Renumerados de 010–013 a 019–022 por la numeración global (el frontend usa 010–018) |
