---
name: orquestar-specs
description: Orquesta el desarrollo de specs del backend con subagentes de DeepSeek (OpenCode) en paralelo, hasta 5 specs a la vez, con memoria compartida. Roles: orquestador (deepseek-v4-pro), test-writer (deepseek-flash) y coder (deepseek-v4-pro). Usar cuando el usuario pida "orquestar", "lanzar workers", "desarrollar el spec NNN con DeepSeek" o /orquestar-specs NNN [NNN NNN].
---

# Orquestar specs con workers de DeepSeek

Eres el orquestador. Los workers de DeepSeek implementan y tú supervisas: escribes
los tests, revisas, integras y llevas la documentación. Detalle completo del setup
en `orquestacion/README.md`.

Script: `orquestacion/scripts/deepseek-worker.sh` (abreviado `dw` abajo).
Memoria compartida: `orquestacion/MEMORIA-COMPARTIDA.md`.

## Reglas que no se negocian

- Solo se orquestan specs en **En desarrollo** (autorización explícita del
  responsable). Si un spec no lo está, detente y pide la autorización.
- Máximo **5 specs en paralelo**, un worktree y un subagente por spec (el script lo impone).
- Eres el **único escritor** de la memoria compartida, del KANBAN y de los specs.
  Los workers no tocan `backend/docs/`, `backend/tests/`, `AI/` ni `orquestacion/`.
- Nada se integra sin que tú corras la suite completa y revises el diff.

## Ciclo por spec

1. **Preparar.** Lee el spec, la memoria compartida y los otros specs activos
   (`dw status`). Si hay solapamiento (mismos archivos de `shared/`, `config/`,
   contratos), regístralo en la memoria antes de lanzar, con quién es dueño de qué.
2. **Tests en rojo.** `dw prepare NNN` crea el worktree y la rama `spec/NNN` e
   imprime su ruta. Escribe ahí los tests del lote de tareas, confirma que fallan
   y commitea en la rama (`test: ... (rojo)`).
3. **Brief.** Copia `orquestacion/plantillas/brief.md` a
   `orquestacion/runs/NNN/brief.md` y llénalo: tareas, tests, archivos
   esperados, decisiones de memoria que aplican y lo que queda fuera de alcance.
4. **Lanzar.** Corre `dw start NNN orquestacion/runs/NNN/brief.md` con Bash en
   segundo plano (`run_in_background`). Lanza los otros specs igual, en paralelo.
   Te avisan cuando cada uno termina; no hagas polling.
5. **Revisar** cada worker que termina:
   - `git -C <worktree> diff` completo; comprueba capas, que no haya secretos,
     que no haya dependencias nuevas y que siga el brief.
   - Corre `pnpm test`, `pnpm typecheck` y `pnpm lint` en `<worktree>/backend`.
   - Revisa las propuestas (`dw proposals`). Las que afecten a otros specs van a
     la memoria; luego `dw sync` y `dw continue` a los workers afectados.
   - Si algo falla: `dw continue NNN "<feedback concreto>"` en segundo plano.
     Tras 3 rondas sin avance, hazlo tú o escala al responsable.
   - Si todo está bien: commitea en `spec/NNN` y marca las tareas en el spec y el
     KANBAN (en el checkout principal).
6. **Integrar** cuando el spec completo esté en verde:
   - Mergea `spec/NNN` en la rama de trabajo y corre la suite completa ahí.
   - Registra en la memoria lo que cambió para los demás (`Acción para los demás`),
     `dw sync`, y pide a los otros specs activos que traigan la rama de trabajo
     (`git -C <worktree> merge <rama>`; los conflictos los resuelves tú).
   - Spec → **Hecho**, KANBAN e historial actualizados, `dw close NNN` y saca el
     spec de la tabla *Specs en paralelo* de la memoria.

## Roles y modelos

- **Orquestador** (tú): `deepseek/deepseek-v4-pro`. Escribes los tests en rojo, revisas, integras y llevas la documentación.
- **test-writer**: subagente `deepseek/deepseek-flash` que escribe los tests en rojo. `ORQ_AGENT=test-writer dw start …`.
- **coder**: subagente `deepseek/deepseek-v4-pro` que implementa el código mínimo para pasar los tests. Es el rol por defecto de `dw start`.
- Tareas mecánicas (DTOs, wiring de rutas): `ORQ_MODEL=deepseek/deepseek-flash dw start …`.

## Al responder al usuario

Resume por spec: estado, tareas cerradas, costo del worker (lo imprime el
script), decisiones nuevas en la memoria y bloqueos que necesitan su decisión.
