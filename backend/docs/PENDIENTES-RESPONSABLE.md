# Pendientes que requieren al responsable

> Bitácora del orquestador. Cada entrada es algo que bloqueó o limitó un avance
> y que necesita una decisión, una aprobación o una acción manual. El resto del
> trabajo continúa sin esperar. Entradas nuevas arriba; se marcan *Resuelto*, no se borran.

| Fecha | Spec | Pendiente | Qué se necesita | Estado |
|---|---|---|---|---|
| 2026-10-17 | 002 | Cargar el secreto `tranqui/dev/open-payments` con las llaves de la wallet de la plataforma (`walletAddressUrl`, `keyId`, `privateKey`) | Proveer las llaves de la wallet de la plataforma (o el archivo) | Resuelto — cargado y verificado (2026-10-17) |
| 2026-10-17 | 026 | Aprobar el borrador del pago a comercio solo en COP | Revisar [026](specs/026-pago-comercio-cop.md); autorizar su desarrollo | Resuelto — implementado (Hecho) |
| 2026-10-17 | backlog | Conectar `GET /merchants` a la lista de comercios en la base de Google Cloud (el front usa una lista simulada) | Spec del backend aún sin escribir; ver [KANBAN](KANBAN.md#backlog-specs-por-escribir) | Abierto |
| 2026-10-17 | 008 | Ejecución manual del caso 12 (flujo completo contra la red de prueba) y `pnpm test:e2e` contra red real | Ejecutarlo con las wallets de prueba y la llave de la plataforma | Abierto — guía entregada; lo ejecuta el responsable |
| 2026-10-17 | 009 | ¿Hace falta el webhook hacia el agente (fase 2) después del hackatón? | Decidir; hoy el seguimiento es solo por polling | Resuelto — solo polling, sin webhook |
| 2026-10-17 | 022 | Prueba manual del caso 8 (actividad en vivo con pagos reales) | Ejecutarla con el panel y la red de prueba | Abierto — lo ejecuta el responsable luego |
| 2026-10-17 | 024 | Decisiones del spec sin resolver: orden de cobro y un solo cobro vs dos | — | Resuelto — se mantienen dos cobros (monto + comisión), mostrados como un solo total |
| 2026-10-17 | cableado | Monto diario por defecto (valor asumido) | Confirmar o cambiar el valor | Resuelto — `COP:500000` por usuario, configurable desde el admin (spec 020) |
| 2026-10-17 | cableado | `PUBLIC_API_URL` y `CORS_ALLOWED_ORIGINS` no están en el IaC | Definir dominio público | Resuelto — se aplaza al despliegue (spec 002) |
| 2026-10-17 | cableado | Borrar la cuenta con vinculación `PENDING_AUTHORIZATION` no cancela el grant (vence solo) | Decidir | Resuelto — cancelar el grant explícitamente. [spec 027](specs/027-cancelacion-grant-cuenta.md) (Aprobado) |
| 2026-10-17 | 003 | Fixtures HTTP escritos a mano, no capturados de la red de prueba | Validar contra la red real | Resuelto — se aplaza (los fixtures bastan) |
| 2026-10-17 | 023 | Spike manual (caso 1): grant con límite + interval, pagos dentro/sobre el límite, rotar, cancelar | Ejecutarlo en la red de prueba | Resuelto — se aplaza (confirmado por Interledger) |
| 2026-10-17 | 002 | Tarea 11 y verificación de `tranqui-deployer` | Verificar el acceso del usuario deployer | Resuelto — desplegado en `dev` (2026-10-17) |
