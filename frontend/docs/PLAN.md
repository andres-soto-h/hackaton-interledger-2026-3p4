# Plan inicial — App TuTranqui (frontend)

> Estado: **Aprobado** (2026-10-16) · Etapa actual: **planeación** (todavía no hay código)
> Avance en [KANBAN.md](KANBAN.md) · Sistema de diseño en [DISENO.md](DISENO.md) ·
> API en [backend/docs/API.md](../../backend/docs/API.md)

App web y móvil de TuTranqui: el usuario paga servicios a comercios del
directorio y consulta sus transacciones. Se registra con un **passkey** y, una
sola vez, autoriza en su wallet que TuTranqui pague hasta un **monto diario**.
Después cada pago lo **confirma en la app con su passkey**, sin volver a la
wallet. También puede pedirle los pagos a un agente de IA por chat o por voz; el
agente prepara el pago con sus tools, pero **nunca lo confirma**: confirmar
exige el passkey del usuario.

Los mockups de referencia están en el archivo
`TuTranqui — Mockups finales con comisión.html` (19 pantallas, 390 × 844), que
se comparte fuera del repo (está en `frontend/.gitignore`). Son un ejemplo: se
toma de ellos el lenguaje visual, el tono y la estructura de las pantallas, no
todos sus flujos (ver [Diferencias con los mockups](#diferencias-con-los-mockups)).

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Framework | **React Native con Expo** (SDK estable más reciente al iniciar, fijada en `package.json`) | Un solo código para web (objetivo inicial) y Android; Expo trae build web, navegación y módulos nativos sin configurar Gradle a mano |
| Navegación | **Expo Router** (rutas por archivos) | Las rutas son URLs en web: necesario para volver de la wallet a `/vincular/resultado?linkId=…` y para recargar un resultado |
| Lenguaje | TypeScript estricto | Igual que el backend |
| Tests | **Jest (`jest-expo`) + React Native Testing Library** | Vitest no tiene soporte estable para React Native; `jest-expo` es el preset oficial. Misma sintaxis (`describe/it/expect`) que el backend |
| Mocks de la API | **MSW** (Mock Service Worker) | Los tests y el desarrollo local usan la API "de mentira" con los contratos del backend; el front avanza aunque el backend no esté listo |
| Estado del servidor | **TanStack Query** | Caché, reintentos y polling (`refetchInterval` según `Retry-After` del backend 009) |
| Estado de la sesión | React Context | Solo hay sesión y usuario; no justifica una librería |
| Formularios | **react-hook-form + Zod** | Zod ya es la validación del backend; se pueden compartir reglas |
| Autenticación | **Passkeys** con `@simplewebauthn/browser` (backend 019) | Sin contraseñas ni PIN de la app; el mismo passkey confirma cada pago |
| Almacenamiento de la sesión | Memoria + `sessionStorage` en web | Decisión del backend 019; ver [Seguridad](#seguridad) |
| Agente y voz | **Pendiente de definición:** SDK de agentes de Gemini; texto a voz con modelos de Google Cloud | Ver spec [009](specs/009-agente-voz.md) |
| Gestor de paquetes | pnpm | Igual que el backend |
| Despliegue web | Export estático de Expo (`expo export -p web`) servido por CloudFront | Su dominio es el `WEBAUTHN_RP_ID` de los passkeys (backend 019); la infraestructura queda fuera de este plan |
| Metodología | SDD + TDD, mismo flujo que el backend ([PLAN del backend](../../backend/docs/PLAN.md#flujo-de-trabajo-sdd--tdd)) | Regla del proyecto |

## Estructura del frontend

```
frontend/
├── package.json
├── app.json                   ← configuración de Expo (web, android)
├── tsconfig.json
├── jest.config.js             ← preset jest-expo
├── eslint.config.js
├── .env.example               ← EXPO_PUBLIC_API_BASE_URL, sin secretos
├── README.md
├── docs/                      ← este plan, diseño, kanban y specs
├── app/                       ← rutas (Expo Router)
│   ├── _layout.tsx            ← providers (Query, sesión, tema) y fuentes
│   ├── (publico)/             ← sin sesión
│   │   ├── bienvenida.tsx
│   │   ├── registro.tsx
│   │   └── ingresar.tsx
│   └── (app)/                 ← con sesión (guard en el _layout)
│       ├── index.tsx          ← inicio
│       ├── vincular/          ← permiso en la wallet y vuelta desde la wallet
│       ├── transacciones/     ← lista y detalle
│       ├── pagos/             ← directorio, datos, confirmación, resultado
│       ├── agente.tsx         ← chat y voz
│       └── cuenta.tsx         ← mi cuenta
├── src/
│   ├── features/              ← un módulo por funcionalidad
│   │   ├── auth/  transactions/  payments/  merchants/  agent/  voice/
│   │   │   (cada uno: components/, hooks/, api.ts, schemas.ts)
│   ├── api/                   ← cliente HTTP único: base URL, token, errores estándar
│   ├── ui/                    ← componentes del sistema de diseño
│   ├── theme/                 ← tokens (colores, tipografía, espacios)
│   └── lib/                   ← montos, fechas, utilidades puras
└── tests/
    ├── msw/                   ← handlers y fixtures con los contratos de la API
    └── utils/                 ← render con providers
```

### Principios

- **Capas:** pantalla (`app/`) → componentes y hooks de la feature → `api.ts` de
  la feature → `src/api/` (cliente HTTP). Solo `src/api/` hace `fetch`.
- **Pantallas delgadas:** las rutas de `app/` arman componentes; la lógica vive
  en hooks testeables.
- **Contrato primero:** cada spec que consume un endpoint escribe primero sus
  handlers de MSW con el contrato del backend. El front se prueba contra eso.
- **Montos como string:** igual que la API, nunca `Number`/`parseFloat` para
  dinero; el formateo es una función pura con tests (spec 001).
- **Sin secretos en el bundle:** todo lo que va en `EXPO_PUBLIC_*` es público.
  La app **no** usa la API key del backend (ver [Seguridad](#seguridad)).
- **Accesible y responsive:** pensada para personas mayores (como en los
  mockups): textos grandes, botones de al menos 48 px, contraste AA, lectores de
  pantalla. Ver [DISENO.md](DISENO.md).

## Pantallas y specs

| Pantalla | Mockup de referencia | Spec |
|---|---|---|
| Bienvenida | 1.1 | [002](specs/002-inicio-sesion.md) |
| Inicio de sesión con passkey | — | [002](specs/002-inicio-sesion.md) |
| Mi cuenta (permiso, cerrar sesión, eliminar cuenta) | 1.5 ("Mi cuenta") | [002](specs/002-inicio-sesion.md) |
| Registro (nombre, wallet, passkey) | 1.2 (adaptado) | [003](specs/003-registro.md) |
| Permiso en la wallet con monto diario | 1.3, 1.4 (adaptados) | [003](specs/003-registro.md) |
| Inicio | 1.5, 2.1, 3.1 | [004](specs/004-inicio-transacciones.md) |
| Lista y detalle de transacciones | — | [004](specs/004-inicio-transacciones.md) |
| Directorio de comercios y datos del pago | 2.1 | [005](specs/005-pago-servicios.md) |
| Validación del comercio | 1.6, 2.2, 2.3 | [005](specs/005-pago-servicios.md) |
| Confirmación con passkey ("Revisar y decir sí") | 1.7, 2.4 | [006](specs/006-confirmacion-aprobacion.md) |
| Resultado de la transacción | 1.8, 2.5, 3.6 | [007](specs/007-resultado-transaccion.md) |
| Chat con el agente | 3.3 – 3.5 | [008](specs/008-agente-chat.md) |
| Voz con el agente | 3.1 – 3.2 | [009](specs/009-agente-voz.md) |

**Orden de desarrollo:** 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009.

## Flujos en la app

### Registro y permiso (una sola vez)

```
Datos (nombre, wallet) ─▶ Crear passkey ─▶ Permiso en la wallet ─▶ Permiso guardado
        (003)               (003)                (003)                  (003)
  POST /auth/register/*            POST /me/wallet-link ─▶ authorizationUrl
                                   el usuario aprueba el monto diario en su wallet
                                   GET /auth/callback (backend) ─▶ FRONTEND_RESULT_URL
                                   polling GET /me/wallet-link hasta ACTIVE
```

### Pago

```
Directorio ─▶ Datos del pago ─▶ Validación del comercio ─▶ Confirmación ─▶ Resultado
 (005)          (005)               (005)                    (006)          (007)
                        POST /payments ──▶ AWAITING_CONFIRMATION (quote, comisión, disponible)
                        "Sí, pagar" ──▶ passkey ──▶ POST /payments/{id}/confirm ──▶ PROCESSING
                        polling GET /payments/{id} hasta isFinal (backend 009)
```

El agente (008/009) entra al mismo flujo en el paso de **Confirmación**: su
tool crea el pago (`AWAITING_CONFIRMATION`) y la app muestra la tarjeta con el
quote; el usuario lo confirma con su passkey igual que un pago manual.

## Dependencias con el backend

Endpoints especificados en el backend:

| Endpoint | Spec backend | Lo usa |
|---|---|---|
| `POST /api/v1/auth/register/options` · `/verify` | 019 | 003 |
| `POST /api/v1/auth/login/options` · `/verify` | 019 | 002 |
| `GET /api/v1/me` · `DELETE /api/v1/me` | 019 | 002 |
| `POST` · `GET` · `DELETE /api/v1/me/wallet-link`; vuelta a `FRONTEND_RESULT_URL` | 023 | 002, 003 |
| `GET /api/v1/me/allowance` | 023 | 002, 006, 007 |
| `POST /api/v1/payments` | 007 | 005, 008 |
| `POST /api/v1/payments/{id}/confirm/options` · `/confirm` · `/cancel` | 007 | 006 |
| `GET /api/v1/payments/{id}` (`isFinal`, `Retry-After`) | 008, 009 | 006, 007 |
| `GET /api/v1/transactions` (lotes paginados con todos los datos) | 008 | 004 |
| Comisión en el quote y en los pagos | 024 | 006, 007 |

Endpoints que el front necesita y **todavía no tienen spec en el backend**:

| Necesidad | Propuesta de contrato | Lo usa |
|---|---|---|
| Directorio de comercios | `GET /api/v1/merchants?query=&category=` → `{ items: [{ id, name, category, walletAddress, assetCode, assetScale, logoUrl, referenceLabel }] }` (lista fija en Google Cloud) | 005 |
| Validación de la wallet de un comercio | `GET /api/v1/wallets/verify?walletAddress=` → `{ exists, publicName, assetCode, assetScale }` | 005 |
| Agente | `POST /api/v1/agent/messages` `{ conversationId?, text }` → `{ conversationId, reply, actions: [...] }` (ver spec 008; puede cambiar con el SDK de Gemini) | 008, 009 |

Mientras no existan o no estén desplegados, el front se desarrolla y prueba
contra MSW con estos contratos. Si el backend los cambia, se actualizan los
handlers y el spec afectado.

## Seguridad

- **La API key no va en la app.** Todo lo que se empaqueta en una app web o
  Android se puede leer. La app se autentica con la sesión del usuario
  (`Authorization: Bearer`, backend 019).
- **Sin PIN ni contraseña de la app:** el usuario se identifica con su passkey;
  el desbloqueo (huella, rostro o PIN del dispositivo) lo verifica el sistema
  operativo y la API nunca lo ve.
- **Sesión:** memoria + `sessionStorage` (se pierde al cerrar la pestaña); se
  evita `localStorage` para reducir el impacto de un XSS. Vida corta (1 h).
- **Permiso en la wallet una sola vez, con tope diario:** el usuario lo aprueba
  en su wallet al registrarse y lo puede quitar desde Mi cuenta.
- **Cada pago se confirma con el passkey.** Ni el agente ni un "sí" por voz ni
  alguien con la sesión robada pueden confirmar un pago: hace falta que el
  usuario desbloquee su dispositivo.
- **Solo se abren `authorizationUrl` que vienen de la API** y con `https`.
- **Lo que dice el agente se muestra como texto**, nunca como HTML ni como
  enlaces que la app abra sola. Lo que el usuario confirma son los datos de la
  API, no el texto del modelo.

## Diferencias con los mockups

| En el mockup | En la app | Motivo |
|---|---|---|
| Registro con banco + celular (1.2) | Registro con nombre, wallet address y passkey | Requisito del responsable del proyecto |
| Permiso en el banco con tope mensual (1.3, 1.4) | Permiso en la wallet con **monto diario** | Backend 023 |
| "Sí, sin volver a autorizar" (2.4) | Igual: el pago usa el permiso guardado y se confirma con el passkey | Decisión del 2026-10-16 |
| "Le quedan $… del tope del mes" | "Le quedan $… de su monto de hoy" | Monto diario |
| Comisión TuTranqui de 0,001 % | Se muestra la comisión que devuelve la API | Backend 024 |
| "O diga 'sí' en voz alta" | La voz lleva a la confirmación; confirmar exige el passkey | Seguridad |
| "Hablar con una persona", "Enviar comprobante a un familiar" | Fuera de alcance | Backlog |
| Pagos P2P a contactos guardados ("Andrés amigo") | Fuera de alcance de estos specs; el agente paga a comercios del directorio | Requisito: pagos de servicios a comercios registrados |

## Flujo de trabajo (SDD + TDD)

Mismas reglas que el backend ([CLAUDE.md](../../CLAUDE.md)). Los specs del
frontend viven en `frontend/docs/specs/`, se crean desde
[`backend/docs/specs/_TEMPLATE.md`](../../backend/docs/specs/_TEMPLATE.md) y
tienen **numeración propia** desde 001. Para no confundirlos con los del
backend, toda referencia a un spec del backend dice "backend NNN" (p. ej.
"backend 007"); un número solo es un spec del frontend.

Tipos de prueba en los specs del frontend:

| Tipo | Qué prueba | Herramienta |
|---|---|---|
| unit | Funciones puras, schemas, hooks | Jest |
| component | Un componente: render, interacción, accesibilidad | React Native Testing Library |
| integration | Una pantalla completa contra la API simulada | RNTL + MSW |
| manual | Lo que no se automatiza en el hackatón (passkeys reales, red de prueba, voz) | Checklist en el spec |

## Decisiones del plan

Resueltas el 2026-10-16:

| # | Tema | Decisión |
|---|---|---|
| 1 | Stack | Aprobado: Expo, Jest (`jest-expo`) en vez de Vitest, MSW, TanStack Query |
| 2 | Comisión TuTranqui | Se cobra (backend 024); el front la muestra como la devuelve la API |
| 3 | Backend y frontend | Se trabajan de forma independiente. Los commits del frontend solo tocan archivos de `frontend/`. Mientras el backend no tenga los endpoints clave, el front se prueba contra MSW; la integración real se hace cuando ambos se encuentren |
| 4 | Volver de la wallet en Android | Opción (a): abrir la wallet con `expo-web-browser` y consultar el estado por polling. Hoy solo aplica a la vinculación (003), y en esta fase la app en Android se usa desde Chrome porque los passkeys nativos son deuda técnica del backend (TD-003) |
| 5 | Mockups en el repo | No se versionan; quedan en `frontend/.gitignore` |
| 6 | Autenticación | Passkeys, sin PIN de la app (backend 019) |
| 7 | Aprobación de pagos | Una sola vez al vincular la wallet, con monto diario (backend 023); cada pago se confirma en la app con el passkey. Si la prueba del spec 006 (tarea 1) falla, se cambia front y back |
