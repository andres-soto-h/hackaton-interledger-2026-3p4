# Pendientes que requieren al responsable

> Bitácora del orquestador. Cada entrada es algo que bloqueó o limitó un avance
> y que necesita una decisión, una aprobación o una acción manual. El resto del
> trabajo continúa sin esperar. Entradas nuevas arriba; se marcan *Resuelto*, no se borran.

| Fecha | Spec | Pendiente | Qué se necesita | Estado |
|---|---|---|---|---|
| 2026-10-17 | 024 | Decisiones del spec sin resolver: orden de cobro y un solo cobro vs dos | Se desarrolla con las recomendaciones del spec (primero el pago, después la comisión; dos cobros mostrados como un solo total). Confirmar o cambiar | Abierto (desarrollo continúa con el valor por defecto) |
| 2026-10-17 | cableado | Monto diario por defecto `USD:200` (valor asumido por el orquestador) | Confirmar o cambiar el valor (editable luego desde el panel, spec 020) | Abierto |
| 2026-10-17 | cableado | `PUBLIC_API_URL` y `CORS_ALLOWED_ORIGINS` no están en el IaC; en Lambda el callback usa el dominio de la primera petición | Definir dominio público y añadir ambas variables a la plantilla (spec 002, pausado) | Abierto |
| 2026-10-17 | cableado | Borrar la cuenta con vinculación `PENDING_AUTHORIZATION` no cancela el grant pendiente (vence solo) | Decidir si se cancela explícitamente | Abierto (bajo riesgo) |
| 2026-10-17 | 003 | Fixtures HTTP escritos a mano, no capturados de la red de prueba | Validar el adapter contra la red de prueba real con credenciales de la wallet de la plataforma | Abierto |
| 2026-10-17 | 023 | Spike manual (caso 1): grant con `debitAmount` + `interval`, pagos dentro y sobre el límite, rotar y cancelar | Ejecutarlo en la red de prueba (requiere wallets de prueba y la llave de la plataforma) | Abierto (no bloquea el desarrollo con fakes) |
| 2026-10-17 | 002 | Tarea 11 y verificación de `tranqui-deployer` | Primer `cdk deploy` a `dev` cuando exista una versión inicial del backend | Abierto (spec pausado) |
