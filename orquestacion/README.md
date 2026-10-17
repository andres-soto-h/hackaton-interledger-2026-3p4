# Orquestación: Claude + workers de DeepSeek

Setup para desarrollar specs del backend en paralelo (máximo 5) con un
**orquestador de Claude** (Claude Code) que supervisa a **workers de DeepSeek**
(OpenCode). Creado el 2026-10-16.

## Arquitectura

```
Claude Code (orquestador, checkout principal)
 │  lee el spec · escribe los tests en rojo · escribe el brief
 │  único escritor de: specs, KANBAN, MEMORIA-COMPARTIDA.md
 │
 ├──► worker DeepSeek · spec A · worktree ../<repo>-worktrees/spec-A · rama spec/A
 ├──► worker DeepSeek · spec B · worktree ../<repo>-worktrees/spec-B · rama spec/B
 └──► worker DeepSeek · spec C · worktree ../<repo>-worktrees/spec-C · rama spec/C
        implementan hasta poner los tests en verde · proponen decisiones
        │
        ▼
 orquestador revisa el diff + corre test/typecheck/lint → commitea → integra
```

**Principio de control:** Claude escribe los tests y DeepSeek solo implementa.
Los tests son el contrato. El worker no puede modificarlos (permiso denegado),
así que no puede "aprobarse a sí mismo".

## Regla de paralelismo (CLAUDE.md)

- Máximo **5 specs En desarrollo a la vez**, uno por worktree y rama `spec/NNN`.
- Condición: la memoria compartida al día. Toda decisión que afecte a otro spec
  activo se registra en [MEMORIA-COMPARTIDA.md](MEMORIA-COMPARTIDA.md) y se
  propaga a los workers antes de integrar.
- Sigue vigente el resto del flujo SDD: Aprobado ≠ En desarrollo; Hecho solo con
  toda la suite en verde (en la rama de trabajo, después del merge).

## Archivos del setup

| Archivo | Qué es |
|---|---|
| [`.opencode/agent/backend-worker.md`](../.opencode/agent/backend-worker.md) | Definición del worker en OpenCode: modelo, permisos y prompt de sistema |
| [`AGENTS.md`](../AGENTS.md) | Symlink a `CLAUDE.md`. Es el archivo de reglas que lee OpenCode |
| [`.claude/skills/orquestar-specs/SKILL.md`](../.claude/skills/orquestar-specs/SKILL.md) | Ciclo del orquestador. Se invoca con `/orquestar-specs NNN [NNN NNN]` |
| [`scripts/deepseek-worker.sh`](scripts/deepseek-worker.sh) | Crea los worktrees, lanza y continúa workers, sincroniza la memoria y aplica el máximo de 3 |
| [`MEMORIA-COMPARTIDA.md`](MEMORIA-COMPARTIDA.md) | Decisiones compartidas entre specs en paralelo (versionado) |
| [`plantillas/brief.md`](plantillas/brief.md) | Plantilla del encargo que recibe cada worker |
| `runs/NNN/` | Briefs, logs JSONL, sesión y pid de cada worker (ignorado por git) |
| `.orquestacion/` (en cada worktree) | Copia de la memoria y propuestas del worker (ignorado por git) |

## Requisitos

- OpenCode ≥ 1.17 (`~/.opencode/bin/opencode`) con la credencial de DeepSeek:
  `opencode auth login` → DeepSeek. Se guarda en `~/.local/share/opencode/auth.json`,
  nunca en el repo.
- `jq`, `pnpm`, `git` ≥ 2.38.
- Claude Code en el checkout principal.

Verificación rápida:

```bash
opencode models deepseek     # debe listar deepseek/deepseek-v4-pro y deepseek/deepseek-flash
                             # (el catálogo cambia: si un ID desaparece, actualizar el agente y este README)
OPENCODE_CONFIG_DIR=$PWD/.opencode opencode agent list | grep backend-worker
```

## Los subagentes (`coder` y `test-writer`)

Definidos en `.opencode/agents/` (formato V2). El script elige el rol con
`ORQ_AGENT` (por defecto `coder`) y fija el modelo según el rol:

- **`coder`** — `deepseek/deepseek-v4-pro`, máximo 150 pasos. Implementa el código mínimo para pasar los tests. No toca `backend/tests/` ni `backend/docs/`.
- **`test-writer`** — `deepseek/deepseek-flash`, máximo 100 pasos. Escribe los tests en rojo. Solo toca `backend/tests/` y `backend/infra/test/`.

`ORQ_MODEL` sobreescribe el modelo por rol para tareas mecánicas
(p. ej. `ORQ_MODEL=deepseek/deepseek-flash`).
- **Puede:** leer todo el repo, editar código y correr `pnpm test | typecheck |
  lint | format` (y `test | typecheck` en `backend/infra`), `git status | diff | log`, `ls` y `cat .orquestacion/*`.
- **No puede:** editar `backend/tests/`, `backend/infra/test/`, `backend/docs/`, `frontend/`, `AI/`,
  `orquestacion/`, `CLAUDE.md`, `AGENTS.md`, `.opencode/`, `.claude/`, `backend/keys/`, `.env*` ni
  el ejemplo `backend/src/api/index.js`. Tampoco puede correr otro bash
  (incluidos `git commit` y `pnpm add`), salir del worktree, usar subagentes,
  skills ni búsqueda web, ni hacer preguntas (corre sin interacción).
- Las reglas se evalúan en orden y **gana la última que coincide**: primero el
  comodín y después las excepciones.
- Ninguna regla queda en `ask`: en `opencode run` no hay quién responda y el
  proceso se puede colgar.
- **El agente se carga desde el checkout principal.** El script exporta
  `OPENCODE_CONFIG_DIR=<repo>/.opencode`, así todos los worktrees usan la misma
  definición aunque su rama no la tenga commiteada.

## Memoria compartida

- **Fuente:** `orquestacion/MEMORIA-COMPARTIDA.md` en el checkout principal.
  Solo la escribe el orquestador.
- **Copia de lectura:** `dw sync` la copia a `<worktree>/.orquestacion/MEMORIA.md`.
  El worker la relee antes de cada tarea y antes de terminar, así que una
  decisión nueva le llega aunque esté a mitad de trabajo.
- **Propuestas:** el worker escribe en `<worktree>/.orquestacion/PROPUESTAS.md`.
  El orquestador las revisa (`dw proposals`) y promueve a la memoria las que
  apliquen.
- **Aviso activo:** después de promover algo, `dw continue NNN "<qué cambió>"` a
  los workers afectados. `continue` siempre vuelve a sincronizar la memoria.
- **Al integrar** un spec: entrada con *Acción para los demás*, `dw sync` y merge
  de la rama de trabajo en los otros worktrees.

## Uso del script

`dw` = `orquestacion/scripts/deepseek-worker.sh`

```bash
dw prepare 019                          # worktree + rama spec/019 (para escribir los tests en rojo)
dw start 019 orquestacion/runs/019/brief.md   # lanza el worker (el orquestador lo corre en segundo plano)
dw continue 019 "El test X falla porque …"       # feedback en la misma sesión
dw status                               # specs activos, si corren, archivos con cambios
dw proposals                            # propuestas de decisión de cada worker
dw sync                                 # memoria → todos los worktrees
dw close 019                            # quita el worktree tras integrar (la rama queda)
```

Al terminar, `start` y `continue` imprimen: código de salida, ID de sesión, costo
en USD, el reporte del worker, `git status` del worktree y las propuestas.

Variables: `ORQ_MODEL`, `ORQ_WORKTREES` (por defecto `../<repo>-worktrees`) y
`ORQ_MAX_SPECS` (por defecto 3).

## Ciclo completo

Está descrito paso a paso en el skill
[`orquestar-specs`](../.claude/skills/orquestar-specs/SKILL.md). En resumen:

1. Verificar que el spec esté **En desarrollo** y revisar el solapamiento con los
   otros specs activos.
2. `dw prepare NNN` → escribir los tests en rojo → commit en `spec/NNN`.
3. Brief desde la plantilla → `dw start` en segundo plano (hasta 3 a la vez).
4. Revisar el diff y correr test/typecheck/lint; promover propuestas; dar feedback con `continue`.
5. Commit en `spec/NNN` y actualizar los checkboxes del spec y del KANBAN.
6. Spec completo → merge a la rama de trabajo → suite completa → **Hecho** →
   memoria + `sync` → `dw close`.

## Alternativa evaluada

DeepSeek expone un endpoint compatible con la API de Anthropic. Con él se podría
usar `claude -p` como worker (`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`).
Se eligió OpenCode porque ya estaba instalado y probado, y porque permite permisos
por ruta en el propio agente.
