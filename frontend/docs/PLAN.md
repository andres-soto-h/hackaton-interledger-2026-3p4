# Plan inicial — App TuTranqui (frontend)

> Estado: **Aprobado** (2026-10-16) · Etapa actual: **planeación** (todavía no hay código)
> Avance en [KANBAN.md](KANBAN.md) · Sistema de diseño en [DISENO.md](DISENO.md) ·
> API en [backend/docs/API.md](../../backend/docs/API.md)

App móvil y web de TuTranqui: el usuario paga servicios a comercios del
directorio, aprueba cada pago en su propia wallet y consulta sus transacciones.
También puede pedirle los pagos a un agente de IA por chat o por voz; el agente
prepara el pago con sus tools, pero **nunca lo aprueba**: la aprobación siempre
la hace el usuario.

Los mockups de referencia están en el archivo
`TuTranqui — Mockups finales con comisión.html` (19 pantallas, 390 × 844), que
se comparte fuera del repo (está en `frontend/.gitignore`). Son un ejemplo: se toma de ellos el lenguaje
visual, el tono y la estructura de las pantallas, no todos sus flujos
(ver [Diferencias con los mockups](#diferencias-con-los-mockups)).

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Framework | **React Native con Expo** (SDK estable más reciente al iniciar, fijada en `package.json`) | Un solo código para web (objetivo inicial) y Android; Expo trae build web, navegación y módulos nativos sin configurar Gradle a mano |
| Navegación | **Expo Router** (rutas por archivos) | Las rutas son URLs en web: necesario para volver de la wallet a `/pagos/resultado?paymentId=…` |
| Lenguaje | TypeScript estricto | Igual que el backend |
| Tests | **Jest (`jest-expo`) + React Native Testing Library** | Vitest no tiene soporte estable para React Native; `jest-expo` es el preset oficial. Misma sintaxis (`describe/it/expect`) que el backend |
| Mocks de la API | **MSW** (Mock Service Worker) | Los tests y el desarrollo local usan la API "de mentira" con los contratos del backend; el front avanza aunque el backend no esté listo |
| Estado del servidor | **TanStack Query** | Caché, reintentos y polling (`refetchInterval` según `Retry-After` del backend 009) |
| Estado de la sesión | React Context | Solo hay sesión y usuario; no justifica una librería |
| Formularios | **react-hook-form + Zod** | Zod ya es la validación del backend; se pueden compartir reglas |
| Almacenamiento de la sesión | `expo-secure-store` en Android; memoria + `sessionStorage` en web | Ver [Seguridad](#seguridad) |
| Voz | `expo-speech` (texto a voz) y `expo-speech-recognition` (voz a texto; Web Speech API en web) | Funcionan en web y Android con la misma API |
| Gestor de paquetes | pnpm | Igual que el backend |
| Despliegue web | Export estático de Expo (`expo export -p web`) | Infraestructura fuera de alcance de este plan |
| Metodología | SDD + TDD, mismo flujo que el backend ([PLAN del backend](../../backend/docs/PLAN.md#flujo-de-trabajo-sdd--tdd)) | Regla del proyecto |

## Estructura del frontend

```
frontend/
├── package.json
├── app.json                   ← configuración de Expo (scheme del deep link, web, android)
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
| Registro (nombre, correo, wallet, PIN) | 1.2 – 1.4 (adaptado) | [003](specs/003-registro.md) |
| Inicio de sesión (correo, PIN) | — | [002](specs/002-inicio-sesion.md) |
| Mi cuenta (cerrar sesión, eliminar cuenta) | 1.5 ("Mi cuenta") | [002](specs/002-inicio-sesion.md) |
| Inicio | 1.5, 2.1, 3.1 | [004](specs/004-inicio-transacciones.md) |
| Lista y detalle de transacciones | — | [004](specs/004-inicio-transacciones.md) |
| Directorio de comercios y datos del pago | 2.1 | [005](specs/005-pago-servicios.md) |
| Validación del comercio | 1.6, 2.2, 2.3 | [005](specs/005-pago-servicios.md) |
| Confirmación ("Revisar y decir sí") | 1.7, 2.4 | [006](specs/006-confirmacion-aprobacion.md) |
| Aprobación en la wallet | 1.3 (pantalla del proveedor) | [006](specs/006-confirmacion-aprobacion.md) |
| Resultado de la transacción | 1.8, 2.5, 3.6 | [007](specs/007-resultado-transaccion.md) |
| Chat con el agente | 3.3 – 3.5 | [008](specs/008-agente-chat.md) |
| Voz con el agente | 3.1 – 3.2 | [009](specs/009-agente-voz.md) |

**Orden de desarrollo:** 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009.

## Flujo de pago en la app

```
Directorio ─▶ Datos del pago ─▶ Validación del comercio ─▶ Confirmación
 (005)          (005)               (005)                    (006)
                                                               │ "Sí, pagar"
                                    POST /api/v1/payments ◀────┘  (quote + authorizationUrl)
                                                               │
                                       Wallet del usuario ◀────┘  el usuario aprueba o rechaza
                                       (authorizationUrl)
                                              │ redirect
                       GET /api/v1/auth/callback (backend) ─▶ FRONTEND_RESULT_URL
                                              │
                                      Resultado (007) ── polling GET /payments/{id}
                                                         hasta isFinal (backend 009)
```

El agente (008/009) entra al mismo flujo en el paso de **Confirmación**: su
tool crea el pago y la app muestra la tarjeta de confirmación con el quote; el
usuario la aprueba igual que un pago manual.

## Dependencias con el backend

Endpoints que ya están especificados en el backend:

| Endpoint | Spec backend | Lo usa |
|---|---|---|
| `POST /api/v1/payments` | 007 | 006, 008 |
| `GET /api/v1/auth/callback` → `FRONTEND_RESULT_URL` | 007 | 007 |
| `GET /api/v1/payments/{id}` (`isFinal`, `Retry-After`) | 008, 009 | 007 |
| `GET /api/v1/transactions` | 008 | 004 |

Endpoints que el front necesita y **todavía no tienen spec en el backend**
(se agregan al backlog del [KANBAN del backend](../../backend/docs/KANBAN.md)):

| Necesidad | Propuesta de contrato | Lo usa |
|---|---|---|
| Registro de usuario | `POST /api/v1/users` `{ name, email, walletAddress, pin }` → `201 { user, token }`; valida que la wallet exista | 003 |
| Inicio de sesión | `POST /api/v1/sessions` `{ email, pin }` → `200 { user, token }`; bloqueo tras intentos fallidos | 002 |
| Usuario actual / eliminar cuenta | `GET /api/v1/users/me` · `DELETE /api/v1/users/me` | 002 |
| Autenticación de la app | `Authorization: Bearer <token>` en vez de `x-api-key` | todos |
| Directorio de comercios | `GET /api/v1/merchants?query=&category=` → `{ items: [{ id, name, category, walletAddress, logoUrl, referenceLabel }] }` | 005 |
| Validación de una wallet | `GET /api/v1/wallets/verify?walletAddress=` → `{ exists, publicName, assetCode, assetScale }` | 003, 005 |
| Transacciones del usuario en sesión | `GET /api/v1/transactions` toma la wallet del token (sin `walletAddress` en el query) | 004 |
| Agente | `POST /api/v1/agent/messages` `{ conversationId?, text }` → `{ conversationId, reply, actions: [...] }` (ver spec 008) | 008, 009 |

Mientras no existan, el front se desarrolla y prueba contra MSW con estos
contratos. Si el backend los cambia al especificarlos, se actualizan los
handlers y el spec afectado.

## Seguridad

- **La API key no va en la app.** Todo lo que se empaqueta en una app web o
  Android se puede leer. La app se autentica con el token de sesión del
  usuario; el backend decide qué puede hacer cada usuario (por ejemplo, solo
  pagar desde su propia wallet). Esto depende de los specs de usuarios del
  backend y se relaciona con
  [TD-001](../../backend/docs/DEUDA-TECNICA.md#td-001--autenticación-de-la-api-más-fuerte-que-la-api-key).
- **El PIN nunca se guarda en el dispositivo** ni se registra en logs; viaja
  solo por HTTPS al backend, que lo guarda con hash (argon2id o bcrypt).
- **Token de sesión:** `expo-secure-store` en Android. En web, memoria +
  `sessionStorage` (se pierde al cerrar la pestaña); se evita `localStorage`
  para reducir el impacto de un XSS. Vida corta (p. ej. 1 h).
- **La aprobación es del usuario, en su wallet.** Ni el agente ni un "sí" por
  voz aprueban un pago: solo llevan a la pantalla de confirmación, y el débito
  lo autoriza el usuario en su proveedor de wallet (grant interactivo).
- **Solo se abren `authorizationUrl` que vienen de la API** y con `https`.
- **Lo que dice el agente se muestra como texto**, nunca como HTML ni como
  enlaces que la app abra sola.

## Diferencias con los mockups

| En el mockup | En la app | Motivo |
|---|---|---|
| Registro con banco + celular y permiso con tope mensual (1.2 – 1.4) | Registro con nombre, correo, wallet address y PIN | Requisito del responsable del proyecto |
| "Sí, sin volver a autorizar" (2.4): un permiso guardado para varios pagos | Cada pago se aprueba en la wallet | Decisión del 2026-10-16: aprobación en cada pago |
| "Tope del mes" y "Le quedan $…" | No se muestra | Depende del permiso guardado |
| Comisión TuTranqui de 0,001 % | Se muestra en la confirmación y el resultado cuando la API la devuelva | La configura un spec del backend (decisión 2 del plan) |
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
| manual | Lo que no se automatiza en el hackatón (Android físico, voz real) | Checklist en el spec |

## Decisiones del plan

Resueltas el 2026-10-16 al aprobar el plan:

| # | Tema | Decisión |
|---|---|---|
| 1 | Stack | Aprobado: Expo, Jest (`jest-expo`) en vez de Vitest, MSW, TanStack Query |
| 2 | Comisión TuTranqui | Se cobra. La configura un spec del backend; el front la muestra cuando la API la devuelva |
| 3 | Backend y frontend | Se trabajan de forma independiente. Los commits del frontend solo tocan archivos de `frontend/`. Mientras el backend no tenga los endpoints clave, el front se prueba contra MSW; la integración real se hace cuando ambos se encuentren |
| 4 | Volver de la wallet en Android | Opción (a): abrir la wallet con `expo-web-browser` y, al cerrarse, ir al resultado y consultar el estado por polling. No cambia el backend |
| 5 | Mockups en el repo | No se versionan; quedan en `frontend/.gitignore` |
