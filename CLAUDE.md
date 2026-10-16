# CLAUDE.md

App de pagos P2P / P2M sobre Open Payments (Interledger). Plan completo en
[backend/docs/PLAN.md](backend/docs/PLAN.md); avance en [backend/docs/KANBAN.md](backend/docs/KANBAN.md).

## Stack

TypeScript · Node.js · Express · Vitest + supertest · pnpm · AWS Lambda.

## Flujo obligatorio (SDD + TDD)

- Toda funcionalidad tiene su propio spec en `backend/docs/specs/NNN-<nombre>.md`, creado
  desde `backend/docs/specs/_TEMPLATE.md` y numerado en orden de creación.
- Un spec nuevo nace como **Borrador**. No pasa a **Aprobado** sin aprobación
  explícita del responsable del proyecto.
- No se escribe código de un spec sin autorización explícita para iniciar su
  desarrollo (**En desarrollo**). Aprobar el spec no autoriza el desarrollo.
- TDD: primero tests en rojo, luego el código mínimo para pasarlos, luego refactor.
- Un spec solo pasa a **Hecho** con toda la suite de tests en verde. No se inicia
  otro spec antes de eso.
- En cada cambio de estado o avance de tareas, actualizar `backend/docs/KANBAN.md`
  (tablero + historial) y la sección *Estado* y checkboxes del spec.

## Reglas de código

- Capas por módulo: routes → controller → service → `integrations/`. Solo
  `integrations/open-payments` usa el SDK de Interledger.
- Nunca poner llaves privadas, key IDs ni otros secretos en el código.
- `backend/src/api/index.js` es solo un ejemplo de referencia; no se modifica ni
  se usa como base de código.
