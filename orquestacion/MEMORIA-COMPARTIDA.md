# Memoria compartida entre specs en paralelo

Decisiones y cambios que afectan a más de un spec en desarrollo. Es obligatoria
para todos los agentes: el orquestador y los workers la leen antes de cada tarea.

- **Un solo escritor:** solo el orquestador edita este archivo. Los workers
  proponen en `.orquestacion/PROPUESTAS.md` de su worktree.
- **Propagación:** después de cada cambio, el orquestador corre
  `orquestacion/scripts/deepseek-worker.sh sync` y avisa con `continue` a los
  workers afectados.
- Entradas nuevas arriba. Una entrada se marca *Reemplazada* en lugar de borrarse.

Formato:

```
### AAAA-MM-DD · <título corto>
- Origen: spec NNN (worker | orquestador | responsable)
- Afecta: specs NNN, NNN · archivos/módulos
- Decisión: …
- Acción para los demás: … (o "ninguna")
```

## Specs en paralelo

| Spec | Rama | Worktree | Desde |
|---|---|---|---|
| — | — | — | — |

## Decisiones

_Sin entradas todavía._
