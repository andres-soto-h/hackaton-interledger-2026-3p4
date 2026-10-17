# CLAUDE.md

App de pagos P2P / P2M sobre Open Payments (Interledger). Plan completo en
[backend/docs/PLAN.md](backend/docs/PLAN.md); avance en [backend/docs/KANBAN.md](backend/docs/KANBAN.md).
Visión de la API en [backend/docs/API.md](backend/docs/API.md); seguridad en
[backend/docs/SEGURIDAD.md](backend/docs/SEGURIDAD.md); deuda técnica en
[backend/docs/DEUDA-TECNICA.md](backend/docs/DEUDA-TECNICA.md).
Frontend (React Native + Expo): plan en [frontend/docs/PLAN.md](frontend/docs/PLAN.md);
avance en [frontend/docs/KANBAN.md](frontend/docs/KANBAN.md); diseño en
[frontend/docs/DISENO.md](frontend/docs/DISENO.md).
`AI/` es solo para prompts y consideraciones sobre el uso de IA en la hackatón;
la configuración de agentes, scripts y memoria compartida va en
[orquestacion/](orquestacion/README.md).

## Stack

TypeScript · Node.js · Express · Vitest + supertest · pnpm · AWS Lambda.

## Flujo obligatorio (SDD + TDD)

- Toda funcionalidad tiene su propio spec en `backend/docs/specs/NNN-<nombre>.md` (o
  `frontend/docs/specs/` si es del frontend), creado desde
  `backend/docs/specs/_TEMPLATE.md` y numerado en orden de creación. Cada carpeta
  numera sus specs desde 001; para referirse a un spec de la otra carpeta se
  escribe "backend NNN" o "frontend NNN".
- Un spec nuevo nace como **Borrador**. No pasa a **Aprobado** sin aprobación
  explícita del responsable del proyecto.
- No se escribe código de un spec sin autorización explícita para iniciar su
  desarrollo (**En desarrollo**). Aprobar el spec no autoriza el desarrollo.
- TDD: primero tests en rojo, luego el código mínimo para pasarlos, luego refactor.
- Un spec solo pasa a **Hecho** con toda la suite de tests en verde.
- Paralelismo: máximo **5 specs En desarrollo a la vez**, cada uno en su propio
  worktree y rama (`spec/NNN`), y siempre con la memoria compartida
  [orquestacion/MEMORIA-COMPARTIDA.md](orquestacion/MEMORIA-COMPARTIDA.md):
  toda decisión o cambio que afecte a otro spec activo se registra ahí y se
  propaga a los demás agentes antes de integrar. Sin memoria compartida, se
  trabaja un spec a la vez. Setup de orquestación (Claude + workers de DeepSeek)
  en [orquestacion/README.md](orquestacion/README.md).
- En cada cambio de estado o avance de tareas, actualizar el KANBAN de la carpeta
  (`backend/docs/KANBAN.md` o `frontend/docs/KANBAN.md`: tablero + historial) y la sección *Estado* y checkboxes del spec.

## Reglas de código

- Capas por módulo: routes → controller → service → `integrations/`. Solo
  `integrations/open-payments` usa el SDK de Interledger.
- Nunca poner llaves privadas, key IDs ni otros secretos en el código.
- `backend/src/api/index.js` es solo un ejemplo de referencia; no se modifica ni
  se usa como base de código.
