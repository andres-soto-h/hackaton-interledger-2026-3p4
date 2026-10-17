# 027 — Cancelación del grant pendiente al borrar la cuenta

| Campo | Valor |
|---|---|
| Estado | **Hecho** |
| Creado | 2026-10-17 |
| Spec aprobado | 2026-10-17 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | 2026-10-17 |

## Estado

3 / 3 tareas completadas e integradas en `develop-andres` (1109 tests en verde, typecheck y lint limpios).

## Contexto

Al borrar una cuenta (`DELETE /me`), el hook `beforeDeleteAccount` revoca la
vinculación `ACTIVE` (cancela el grant con `gateway.cancelGrant`). Pero si la
vinculación está `PENDING_AUTHORIZATION` (el usuario pidió autorizar y aún no
terminó), el grant queda pedido en la wallet y solo vence por sí solo.

El responsable decidió (2026-10-17) cancelar explícitamente ese grant pendiente al
borrar la cuenta, para no dejar autorizaciones huérfanas.

## Alcance

**Incluye**
- Cancelar el grant de una vinculación `PENDING_AUTHORIZATION` al borrar la cuenta.
- Marcar la vinculación `REVOKED` (o eliminarla) tras cancelar.

**No incluye**
- Cancelar grants en otros estados (ya cubierto por `revokeForUser` para `ACTIVE`).

## Criterios de aceptación

- **Dado** una cuenta con vinculación `PENDING_AUTHORIZATION`, **cuando** se borra
  la cuenta, **entonces** se cancela el grant en la wallet y la vinculación no
  queda pendiente.
- **Dado** que la cancelación del grant falla (red, wallet), **cuando** ocurre,
  **entonces** se registra en el log técnico y el borrado de la cuenta continúa.

## Diseño

- `WalletLinksService.revokeForUser` (o un método nuevo) busca también la
  vinculación `PENDING_AUTHORIZATION` del usuario y, si tiene `continueUri` y
  `continueToken`, llama a `gateway.cancelGrant({ continueUri, continueToken })`
  antes de marcarla `REVOKED`.
- Se reutiliza `findLatestByUser` (ya existe en el repositorio) para localizar la
  vinculación pendiente.
- Sin cambios en la API: se reutiliza `beforeDeleteAccount` (cableado ya existente).

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Borrar cuenta con vinculación pendiente | El fake gateway registra la cancelación y la vinculación queda `REVOKED` |
| 2 | Integration | Cancelación que falla | El borrado continúa y se registra el fallo |
| 3 | Integration | Borrar cuenta con vinculación activa | Comportamiento actual sin cambios |

## Tareas

1. [x] Cancelar el grant pendiente en `revokeForUser` (casos 1–2).
2. [x] Repositorio: se reutiliza `findLatestByUser` (sin método nuevo).
3. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

Ninguna.

## Notas

- Complementa el spec 023 (vinculación de wallet) y el spec 019 (cuentas de usuario).
