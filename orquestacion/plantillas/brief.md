# Brief · spec NNN — <nombre>

Spec: `backend/docs/specs/NNN-<nombre>.md`
Tareas de este brief: <números de las tareas del spec>

## Objetivo

<Qué debe quedar funcionando al terminar, en 2–3 líneas.>

## Tests en rojo que debes poner en verde

- `backend/tests/unit/<...>.test.ts`
- `backend/tests/integration/<...>.test.ts`

Comando: `cd backend && pnpm test`

## Archivos esperados

- `backend/src/modules/<modulo>/<modulo>.routes.ts`
- `backend/src/modules/<modulo>/<modulo>.controller.ts`
- `backend/src/modules/<modulo>/<modulo>.service.ts`

## Decisiones de la memoria compartida que aplican

- <Título de la entrada en .orquestacion/MEMORIA.md, o "ninguna">

## Fuera de alcance

- <Lo que no debe tocar aunque parezca relacionado.>

## Criterio de terminado

`pnpm test`, `pnpm typecheck` y `pnpm lint` en verde, sin modificar tests, y el
bloque `## Reporte` al final.
