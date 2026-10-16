# Kanban de specs

> Actualizado: 2026-10-16 · Flujo y reglas en [PLAN.md](PLAN.md#flujo-de-trabajo-sdd--tdd)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| | | [001 — Infraestructura AWS Lambda](specs/001-infraestructura-aws-lambda.md) · 9/15 | |

## Backlog (specs por escribir)

Funcionalidades identificadas en el plan; cada una se redacta como spec y se
aprueba antes de pasar al tablero.

- Bootstrap del backend (app, `/health`, config, errores, logger, setup de tests, `lambda.ts`)
- Cliente de Open Payments (integración y grants no interactivos)
- Solicitar pago — `POST /api/v1/payment-requests`
- Hacer pago y autenticación — `POST /api/v1/payments` + `GET /api/v1/auth/callback`
- Consultar transacciones — `GET /api/v1/transactions`

## Historial

| Fecha | Spec | Cambio |
|---|---|---|
| 2026-10-16 | 001 | Creado como borrador |
| 2026-10-16 | 001 | Agregada autenticación por API key y tarea de evaluar JWT |
| 2026-10-16 | 001 | Spec aprobado → Aprobado |
| 2026-10-16 | 001 | Desarrollo aprobado → En desarrollo |
| 2026-10-16 | 001 | Plantilla IaC completa (tareas 3–9), 10/10 tests en verde |
