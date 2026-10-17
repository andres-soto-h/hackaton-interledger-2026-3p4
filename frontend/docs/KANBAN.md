# Kanban de specs — frontend

> Actualizado: 2026-10-17 · Plan en [PLAN.md](PLAN.md) · Diseño en [DISENO.md](DISENO.md) ·
> Specs del backend en [backend/docs/KANBAN.md](../../backend/docs/KANBAN.md)

| Borrador | Aprobado | En desarrollo | Hecho |
|---|---|---|---|
| | | [008 — Agente por chat](specs/008-agente-chat.md) · 5/6 · *tarea 5: contrato del agente pendiente del backend y del SDK de Gemini* | |
| | | [006 — Confirmación del pago](specs/006-confirmacion-aprobacion.md) · 5/7 · *faltan 2 pruebas manuales contra la red de prueba* | |
| | | [005 — Pago de servicios](specs/005-pago-servicios.md) · 5/6 · *tarea 5 es un pendiente del backend (comercios en Google Cloud)* | |
| | | | [007 — Resultado de la transacción](specs/007-resultado-transaccion.md) · 4/4 |
| | | | [004 — Inicio y transacciones](specs/004-inicio-transacciones.md) · 6/6 |
| | | [003 — Registro y vinculación de la wallet](specs/003-registro.md) · 6/7 · *falta la verificación manual (red de prueba)* | |
| | | [002 — Inicio de sesión y mi cuenta](specs/002-inicio-sesion.md) · 6/7 · *falta la verificación manual con passkeys reales* | |
| | | [001 — Bootstrap del frontend](specs/001-bootstrap-frontend.md) · 10/11 · *falta la verificación manual (web y Android)* | |
| | [009 — Agente por voz](specs/009-agente-voz.md) · 1/9 · *diseño propuesto, pendiente de aprobación* | | |

**Orden de desarrollo:** 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009.
Los specs se desarrollan contra la API simulada (MSW); la integración con el
backend real se verifica cuando su endpoint esté **Hecho**.

## Backlog (specs por escribir)

- Pruebas end-to-end en web (Playwright) del flujo de pago completo
- Despliegue de la app web
- "Hablar con una persona" y "Enviar comprobante a un familiar" (mockups 1.5, 1.8)
- Pagos P2P a contactos guardados (mockups 3.x)

## Historial

| Fecha | Spec | Cambio |
|---|---|---|
| 2026-10-16 | — | Plan del frontend y sistema de diseño creados como borrador a partir de los mockups |
| 2026-10-16 | 001–009 | Creados como borrador |
| 2026-10-16 | 001–009 | Renumerados desde 001 (antes 010–018; numeración propia del frontend). Sesión pasa a 002 y registro a 003 para que el orden de desarrollo sea el numérico |
| 2026-10-16 | — | Plan del frontend aprobado con sus decisiones (stack, comisión, carriles independientes, retorno en Android, mockups fuera del repo) |
| 2026-10-16 | 009 | Voz pendiente de definición técnica: SDK de agentes de Gemini y TTS de Google Cloud; impacta 008 |
| 2026-10-16 | 002, 003 | Autenticación con passkeys, sin PIN; el registro incluye vincular la wallet con monto diario (backend 019 y 023) |
| 2026-10-16 | 005–008 | Los pagos se confirman en la app con el passkey, sin aprobar cada pago en la wallet; el 006 suma la tarea de probarlo |
| 2026-10-16 | 004, 005 | Decisiones resueltas: filtro de un estado, datos completos de la transacción desde el backend, comercios en Google Cloud, referencia en `description` |
| 2026-10-16 | 001–009 | Specs aprobados → Aprobado; pendiente autorizar el desarrollo |
| 2026-10-17 | 005 | Decisiones del responsable: pagos a comercios solo en COP; `p2m` con `receiverWalletAddress` + `amount` (backend 026); directorio simulado en el front y tarea pendiente del backend para conectarlo con Google Cloud |
| 2026-10-17 | 003 | Decisiones: no se pide correo; passkeys en Android solo desde Chrome (TD-003) |
| 2026-10-17 | 006 | Nota: cobro único por el total (backend 025, Borrador); la pantalla no cambia |
| 2026-10-17 | 001 | Desarrollo aprobado → En desarrollo; rama `front/001` (worktree aparte para no cruzarse con el backend) |
| 2026-10-17 | 001 | Tareas 1–9 y 11 hechas: Expo + Router, Jest/RNTL/MSW, `money`, cliente HTTP, tema, componentes base y layout raíz; 65 tests en verde. Falta la verificación manual |
| 2026-10-17 | 002 | Desarrollo aprobado → En desarrollo; rama `front/002`. Passkeys, sesión, guards, ingreso y Mi cuenta hechos; 94 tests en verde. Falta la verificación manual (caso 11) |
| 2026-10-17 | 003 | Desarrollo aprobado → En desarrollo; rama `front/003`. Registro en 2 pasos, permiso en la wallet, vuelta con polling y aviso en el inicio; 142 tests en verde. Pendiente del backend: monto diario antes de vincular |
| 2026-10-17 | 004 | Hecho: inicio, lista paginada con filtro y detalle con polling; 167 tests en verde. Fixtures con monto diario COP 500000 |
| 2026-10-17 | 005 | Desarrollo aprobado → En desarrollo. Directorio simulado, datos, validación del comercio y creación del pago p2m en COP; 221 tests en verde. Falta la tarea 5 (pendiente del backend) |
| 2026-10-17 | 006 | Desarrollo aprobado → En desarrollo. Pantalla de confirmación con passkey, cuenta regresiva y manejo de errores; 262 tests en verde. Faltan las pruebas manuales (tareas 1 y 6) |
| 2026-10-17 | 007 | Hecho: pantalla de resultado con polling según `Retry-After`, tope de 2 min y un texto por estado; 274 tests en verde |
| 2026-10-17 | 008 | Desarrollo aprobado → En desarrollo. Chat con burbujas, acciones del agente (elegir comercio, confirmar pago, estado) contra MSW; 295 tests en verde. Falta registrar el contrato con el backend (tarea 5) |
| 2026-10-17 | 009 | Diseño técnico propuesto: voz en el dispositivo (Web Speech API) con el mismo contrato del chat y TTS del navegador; Chirp 3 HD y Gemini Live como alternativas. Pendiente de aprobación |
