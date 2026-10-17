# Kanban de specs

> Actualizado: 2026-10-17 · Flujo y reglas en [PLAN.md](PLAN.md#flujo-de-trabajo-sdd--tdd) ·
> Visión de la API en [API.md](API.md) · [Seguridad](SEGURIDAD.md) · [Deuda técnica](DEUDA-TECNICA.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| | | | [026 — Pago a comercio con wallet del receptor (solo COP)](specs/026-pago-comercio-cop.md) · 4/4 · [027 — Cancelación de grant al borrar cuenta](specs/027-cancelacion-grant-cuenta.md) · 3/3 |
| | | [028 — Agente de voz (Strands + Bedrock + ElevenLabs)](specs/028-agente-voz.md) · 7/9 · *tarea 8 (pruebas) diferida; falta desplegar y probar con Bedrock y ElevenLabs* | |
| | | [002 — Infraestructura AWS Lambda](specs/002-infraestructura-aws-lambda.md) · 22/22 · *desplegado en `dev` el 2026-10-17; falta cargar el secreto `open-payments`* | [001 — Bootstrap de la API](specs/001-bootstrap-api.md) · 14/14 |
| | | | [004 — Persistencia de pagos](specs/004-persistencia-pagos.md) · 7/7 |
| | | | [005 — Middlewares HTTP](specs/005-middlewares-http.md) · 7/7 |
| | | | [006 — Solicitar pago](specs/006-solicitar-pago.md) · 5/5 |
| | | | [009 — Seguimiento del estado (polling)](specs/009-seguimiento-estado-agente.md) · 4/5 |
| | | | [024 — Comisión por transacción](specs/024-comision-transacciones.md) · 7/7 |
| | | | [007 — Hacer pago (monto diario + passkey)](specs/007-pago-y-autorizacion.md) · 9/9 |
| | | | [021 — Panel admin: gestión de usuarios](specs/021-panel-admin-usuarios.md) · 7/7 |
| | | | [020 — Panel admin: base y configuración](specs/020-panel-admin-configuracion.md) · 9/9 |
| | | | [019 — Cuentas de usuario con passkeys](specs/019-cuentas-usuario-passkeys.md) · 9/9 |
| | | | [003 — Integración con Open Payments](specs/003-integracion-open-payments.md) · 8/8 |
| | | [008 — Consulta de pagos y transacciones](specs/008-consulta-pagos-transacciones.md) · 5/6 · *solo falta la ejecución manual del caso 12 (pendiente del responsable)* | |
| | | [022 — Panel admin: actividad en vivo](specs/022-panel-admin-actividad.md) · 5/6 · *solo falta la prueba manual del caso 8 (pendiente del responsable)* | |
| | | [023 — Vinculación de wallet y monto diario](specs/023-vinculacion-wallet-monto-diario.md) · 9/10 · *solo falta el spike en red real (pendiente del responsable)* · *tope con `interval` confirmado por Interledger (2026-10-17)* | |

**Orden de desarrollo:** 001 → (003, 004) → 005 → 019 → 023 → 006 → 007 → 024 →
008 → 009 → 020 → 021 → 022. Las cuentas (019) y la vinculación (023) van antes
de los pagos porque ahora todo pago requiere sesión y wallet vinculada.
El 002 avanza solo como plantilla IaC: no se despliega hasta tener la mayoría del backend (y requiere reparar el bootstrap de CDK, tarea 22).

**Regla:** los specs cuyo único pendiente es una acción manual del responsable no cuentan para el límite de 3 en paralelo, igual que el 002 pausado.

## Backlog (specs por escribir)

- Webhooks hacia el agente (fase 2 del spec 009, si se aprueba)
- Seguridad como spec propio (si [SEGURIDAD.md](SEGURIDAD.md) lo amerita)
- Pedidos por el frontend ([contratos propuestos](../../frontend/docs/PLAN.md#dependencias-con-el-backend)):
  - Usuarios y sesiones: cubiertos por el 019 (passkeys, sin correo ni PIN)
  - Directorio de comercios — `GET /api/v1/merchants`: **conectar la lista de comercios con la base de datos en Google Cloud** (el front usa una lista simulada hasta entonces; todos en COP)
  - Verificación de wallet del comercio — `GET /api/v1/wallets/verify` (sin spec; el front la simula con MSW)
  - Transacciones del usuario en sesión (ajuste al 008) (cubierto por el 008 ajustado; ya no hay `authorizationUrl` por pago: spec 023)
  - API del agente — `POST /api/v1/agent/messages` con tools sin permiso de aprobar: **spec [028](specs/028-agente-voz.md) (aprobado)**

## Historial

| Fecha | Spec | Cambio |
|---|---|---|
| 2026-10-16 | 001 | Creado como borrador (infraestructura) |
| 2026-10-16 | 001 | Agregada autenticación por API key y tarea de evaluar JWT |
| 2026-10-16 | 001 | Spec aprobado → Aprobado |
| 2026-10-16 | 001 | Desarrollo aprobado → En desarrollo |
| 2026-10-16 | 001 | Plantilla IaC completa (tareas 3–9), 10/10 tests en verde |
| 2026-10-16 | 002 | Infraestructura renumerada de 001 a 002; sigue En desarrollo, bloqueada por 001 para desplegar |
| 2026-10-16 | 001 | Bootstrap de la API creado como borrador; recibe las tareas de cargador de secretos y middleware de API key desde 002 |
| 2026-10-16 | 001 | Spec aprobado → Aprobado (serverless-http, Zod, pino, esbuild) |
| 2026-10-16 | 002 | Aprobados cambios: tabla de pagos con índices, throttling, configuración y alarmas; evaluación de JWT → deuda técnica TD-001 |
| 2026-10-16 | 003–009 | Spec de la API dividido en 7 specs; creados como borrador con [API.md](API.md) y [SEGURIDAD.md](SEGURIDAD.md) como referencia común |
| 2026-10-16 | 002 | Llaves de comercios ficticios → una sola identidad de cliente (wallet de la plataforma); formato del secreto simplificado (impacta 001 y 003) |
| 2026-10-16 | — | Backlog: endpoints que pide el frontend (usuarios, directorio, verificación de wallet, agente) |
| 2026-10-16 | 003 | Agregada la sección *Soporte de distintas monedas* y la URL del proveedor de wallets configurable |
| 2026-10-16 | 004, 009 | Decisiones aprobadas: copia de transacciones en DynamoDB; seguimiento por polling |
| 2026-10-16 | 019 | Cuentas de usuario con passkeys creado como borrador; deuda técnica TD-002 a TD-004 |
| 2026-10-16 | 020–022 | Panel de administración creado como borrador, dividido en tres specs; deuda técnica TD-005 |
| 2026-10-16 | 002 | Agregadas tareas 17–20 de infraestructura requeridas por los specs 019–022 (se implementan cuando esos specs se aprueben) |
| 2026-10-16 | 019–022 | Renumerados de 010–013 a 019–022 por la numeración global (el frontend usa 010–018) |
| 2026-10-16 | 001 | Desarrollo aprobado → En desarrollo |
| 2026-10-16 | 003–006, 008, 019–022 | Specs aprobados → Aprobado (con las recomendaciones de sus decisiones pendientes) |
| 2026-10-16 | 007, 009 | Specs aprobados → Aprobado, con revisión pendiente por el cambio a autorización diaria preaprobada |
| 2026-10-16 | 023, 024 | Creados como borrador: vinculación de wallet con monto diario preaprobado y comisión por transacción; deuda técnica TD-006 |
| 2026-10-16 | 003, 004, 007, 008, 009, 019–022 | Ajustados por la aprobación única con monto diario y la comisión; cambios pendientes de aprobación |
| 2026-10-16 | 001 | 14/14 tareas, 42 tests en verde, lint, typecheck y build limpios → Hecho |
| 2026-10-16 | 003, 004, 007, 008, 009, 019–022 | Cambios por la aprobación única con monto diario y la comisión → aprobados |
| 2026-10-16 | 023, 024 | Specs aprobados → Aprobado |
| 2026-10-16 | 007, 019, 023, 024 | Decisiones: confirmación de pagos con passkey; dominio de CloudFront; día de Bogotá; se asume `interval` (plan B: control en la API); la comisión la paga quien paga |
| 2026-10-16 | 008 | `GET /transactions` devuelve todos los datos de cada transacción (incluido el nombre del comercio) en lotes paginados para carga perezosa; `status` de un solo valor (pedido del frontend 004) |
| 2026-10-16 | — | Regla de flujo: hasta 3 specs En desarrollo en paralelo con memoria compartida ([orquestacion](../../orquestacion/README.md)); orquestación con Claude + workers de DeepSeek |
| 2026-10-16 | 002 | Agregada tarea 22: reparar el bootstrap de CDK de la cuenta `340464868186` con `tranqui-cfn-exec-policy` (bloquea el despliegue, pendiente de autorización); usuario `tranqui-deployer` creado; riesgo de `iam:PutRolePolicy` aceptado y anotado en SEGURIDAD |
| 2026-10-16 | 002 | Decisión: solo plantilla IaC sin desplegar; el despliegue en `dev` espera a que esté la mayoría del backend |
| 2026-10-16 | 003, 004 | Desarrollo aprobado → En desarrollo; en paralelo con el 002 (plantilla IaC) usando workers de DeepSeek |
| 2026-10-16 | 002 | Tareas 13–16 hechas en `spec/002` (índices, throttling, configuración, alarmas); test del caso 5 corregido para permitir los índices |
| 2026-10-16 | 004 | Tareas 1–4 hechas en `spec/004` (tipos, IDs ULID, contrato, repositorio en memoria); pruebas con DynamoDB Local vía Colima + nerdctl en lugar de Docker |
| 2026-10-16 | 002 | Tareas 17–21 hechas en `spec/002` (secretos generados, índices de usuarios y eventos, configuración de passkeys, panel, monto diario y comisión) |
| 2026-10-16 | 003 | Tareas 1–5 hechas en `spec/003` (configuración, montos, anti-SSRF, puerto + fake, `toApiError`) |
| 2026-10-16 | 004 | Tareas 5–6 hechas en `spec/004` (repositorio DynamoDB, `pnpm test:dynamo` con DynamoDB Local) |
| 2026-10-17 | 004 | Integrado en `develop-andres`, suite completa en verde → Hecho |
| 2026-10-17 | 002 | Tareas 13–21 integradas en `develop-andres`; quedan el despliegue y el bootstrap de CDK (tarea 22) |
| 2026-10-17 | 005 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 002 | Tarea 22: `CDKToolkit` borrado y bootstrap rehecho con `tranqui-cfn-exec-policy`; rol de ejecución verificado. Falta comprobar `tranqui-deployer` |
| 2026-10-17 | 003 | Fixtures y adapter del SDK (tareas 6–7); integrado en `develop-andres`, suite completa en verde → Hecho |
| 2026-10-17 | 023 | Confirmado por Interledger: el grant admite límite + `interval` y se autoriza una sola vez (guía oficial enlazada); decisión pendiente 1 pasa a plan B condicionado al spike |
| 2026-10-17 | 005 | Integrado en `develop-andres`, 277 tests en verde → Hecho |
| 2026-10-17 | 019, 020 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 002 | Pausado hasta completar una versión inicial del backend; libera un cupo del límite de 3 specs en paralelo. 006 pasa a En desarrollo |
| 2026-10-17 | 006 | Integrado en `develop-andres`, 416 tests en verde → Hecho |
| 2026-10-17 | 019 | Lote 1 integrado (tareas 3–6; 1 y 7 parciales) |
| 2026-10-17 | 023 | Desarrollo aprobado → En desarrollo (spike de la tarea 1 queda como pendiente del responsable) |
| 2026-10-17 | 020 | Lote 1 integrado (tareas 1, 3, 5, 6, 8; 2 y 4 en memoria) |
| 2026-10-17 | 019 | Lote 2 integrado (DynamoDB, adapter SimpleWebAuthn, OpenAPI, página de prueba); 585 tests en verde → Hecho |
| 2026-10-17 | 021 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 023 | Lote 1 integrado (tareas 2, 3, 5–8; 4 en memoria) |
| 2026-10-17 | 020 | Lote 2 integrado (DynamoDB de ActivityLog y configuración, página de inicio); 694 tests en verde → Hecho |
| 2026-10-17 | 007 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 023 | Lote 2 integrado (DynamoDB con reservas atómicas, OpenAPI); 9/10, falta el spike manual |
| 2026-10-17 | 021 | Integrado en `develop-andres`, 813 tests en verde → Hecho |
| 2026-10-17 | — | Cableado de los módulos 006, 019, 020, 021 y 023 en `createApp` (`src/composition/`, ver [CABLEADO](CABLEADO.md)); almacén de idempotencia en DynamoDB; configuración y secretos nuevos. El router de pagos (007) se monta después vía `extraRouters` |
| 2026-10-17 | 007 | Lote 1 integrado (tareas 1–7), 914 tests en verde |
| 2026-10-17 | 024 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 007 | Cableado en la composición y contrato OpenAPI; 932 tests en verde → Hecho |
| 2026-10-17 | 008 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 024 | Integrado y cableado en `develop-andres`; 1051 tests en verde → Hecho |
| 2026-10-17 | 008 | Integrado y cableado (estado de pago y transacciones); 5/6, falta el caso 12 manual (pendiente del responsable) |
| 2026-10-17 | 009, 022 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 009 | Integrado en `develop-andres`, 1070 tests en verde → Hecho (la tarea 5, revisar el webhook, queda como decisión del responsable) |
| 2026-10-17 | 022 | Integrado en `develop-andres` (actividad en vivo, feed y lista de pagos); reconciliado `listAllPayments` (paginado) con `listEveryPayment` (resumen de comisiones); 1107 tests en verde. Falta la prueba manual del caso 8 (pendiente del responsable) |
| 2026-10-17 | 025, 027 | 025 descartado (se mantienen los dos cobros del 024); 027 aprobado: cancelación del grant pendiente al borrar la cuenta. Monto diario por defecto → `COP:500000` |
| 2026-10-17 | 027 | Desarrollo aprobado → En desarrollo |
| 2026-10-17 | 025 | Creado como borrador: cobro único (monto + comisión) con la plataforma como intermediaria; reemplaza el diseño de dos cobros del 024 (decisión del responsable) |
| 2026-10-17 | 026 | Creado como borrador: `p2m` con `receiverWalletAddress` + `amount`, solo en COP (decisión del responsable; responde al frontend 005) |
| 2026-10-17 | 023 | Nueva tarea 11: cancelar el grant pendiente al borrar la cuenta |
| 2026-10-17 | — | Backlog: conectar `GET /merchants` con la base de Google Cloud; el correo del usuario no se pide (019 sin correo, ingreso con passkey) |
| 2026-10-17 | 027 | Integrado en `develop-andres`, 1109 tests en verde → Hecho |
| 2026-10-17 | 026 | Integrado en `develop-andres`, 1114 tests en verde → Hecho |
| 2026-10-17 | 028 | Creado como borrador: agente de voz con Strands Agents, Amazon Bedrock y ElevenLabs en Lambda; tools para crear pagos, consultar comercios y consultar transacciones; el agente no confirma pagos |
| 2026-10-17 | 028 | Spec aprobado → Aprobado. Decisiones: agente en Python, Claude Haiku en Bedrock (respaldo: pesos abiertos), voz ElevenLabs `JddqVF50ZSIR7SRbJE6u`, pruebas especificadas pero sin ejecutar (directiva vigente), impacto en frontend 008/009 aceptado |
| 2026-10-17 | 028 | Desarrollo aprobado → En desarrollo; rama `develop-local` (directiva de no tests vigente) |
| 2026-10-17 | 028 | Tareas 1–7: Lambda del agente en Python (Strands, 3 tools, voz de ElevenLabs), endpoint `POST /agent/messages`, historial en DynamoDB, CDK, OpenAPI y docs. Sin desplegar; pruebas diferidas por la directiva |
