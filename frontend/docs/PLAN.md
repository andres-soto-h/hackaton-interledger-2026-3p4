# Plan inicial — App TuTranqui (frontend)

> Estado: **Borrador** (2026-10-16) · Etapa actual: **planeación** (todavía no hay código)
> Avance en [KANBAN.md](KANBAN.md) · Sistema de diseño en [DISENO.md](DISENO.md) ·
> API en [backend/docs/API.md](../../backend/docs/API.md)

App móvil y web de TuTranqui: el usuario paga servicios a comercios del
directorio, aprueba cada pago en su propia wallet y consulta sus transacciones.
También puede pedirle los pagos a un agente de IA por chat o por voz; el agente
prepara el pago con sus tools, pero **nunca lo aprueba**: la aprobación siempre
la hace el usuario.

Los mockups de referencia están en
[`frontend/TuTranqui — Mockups finales con comisión.html`](../TuTranqui%20—%20Mockups%20finales%20con%20comisión.html)
(19 pantallas, 390 × 844). Son un ejemplo: se toma de ellos el lenguaje
visual, el tono y la estructura de las pantallas, no todos sus flujos
(ver [Diferencias con los mockups](#diferencias-con-los-mockups)).

## Decisiones propuestas

| Tema | Propuesta | Por qué |
|---|---|---|
| Framework | **React Native con Expo** (SDK estable más reciente al iniciar, fijada en `package.json`) | Un solo código para web (objetivo inicial) y Android; Expo trae build web, navegación y módulos nativos sin configurar Gradle a mano |
| Navegación | **Expo Router** (rutas por archivos) | Las rutas son URLs en web: necesario para volver de la wallet a `/pagos/resultado?paymentId=…` |
| Lenguaje | TypeScript estricto | Igual que el backend |
| Tests | **Jest (`jest-expo`) + React Native Testing Library** | Vitest no tiene soporte estable para React Native; `jest-expo` es el preset oficial. Misma sintaxis (`describe/it/expect`) que el backend |
| Mocks de la API | **MSW** (Mock Service Worker) | Los tests y el desarrollo local usan la API "de mentira" con los contratos del backend; el front avanza aunque el backend no esté listo |
| Estado del servidor | **TanStack Query** | Caché, reintentos y polling (`refetchInterval` según `Retry-After` del spec 009) |
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
  dinero; el formateo es una función pura con tests (spec 010).
- **Sin secretos en el bundle:** todo lo que va en `EXPO_PUBLIC_*` es público.
  La app **no** usa la API key del backend (ver [Seguridad](#seguridad)).
- **Accesible y responsive:** pensada para personas mayores (como en los
  mockups): textos grandes, botones de al menos 48 px, contraste AA, lectores de
  pantalla. Ver [DISENO.md](DISENO.md).

## Pantallas y specs

| Pantalla | Mockup de referencia | Spec |
|---|---|---|
| Bienvenida | 1.1 | [012](specs/012-inicio-sesion.md) |
| Registro (nombre, correo, wallet, PIN) | 1.2 – 1.4 (adaptado) | [011](specs/011-registro.md) |
| Inicio de sesión (correo, PIN) | — | [012](specs/012-inicio-sesion.md) |
| Mi cuenta (cerrar sesión, eliminar cuenta) | 1.5 ("Mi cuenta") | [012](specs/012-inicio-sesion.md) |
| Inicio | 1.5, 2.1, 3.1 | [013](specs/013-inicio-transacciones.md) |
| Lista y detalle de transacciones | — | [013](specs/013-inicio-transacciones.md) |
| Directorio de comercios y datos del pago | 2.1 | [014](specs/014-pago-servicios.md) |
| Validación del comercio | 1.6, 2.2, 2.3 | [014](specs/014-pago-servicios.md) |
| Confirmación ("Revisar y decir sí") | 1.7, 2.4 | [015](specs/015-confirmacion-aprobacion.md) |
| Aprobación en la wallet | 1.3 (pantalla del proveedor) | [015](specs/015-confirmacion-aprobacion.md) |
| Resultado de la transacción | 1.8, 2.5, 3.6 | [016](specs/016-resultado-transaccion.md) |
| Chat con el agente | 3.3 – 3.5 | [017](specs/017-agente-chat.md) |
| Voz con el agente | 3.1 – 3.2 | [018](specs/018-agente-voz.md) |

**Orden de desarrollo:** 010 → 012 → 011 → 013 → 014 → 015 → 016 → 017 → 018.

## Flujo de pago en la app

```
Directorio ─▶ Datos del pago ─▶ Validación del comercio ─▶ Confirmación
 (014)          (014)               (014)                    (015)
                                                               │ "Sí, pagar"
                                    POST /api/v1/payments ◀────┘  (quote + authorizationUrl)
                                                               │
                                       Wallet del usuario ◀────┘  el usuario aprueba o rechaza
                                       (authorizationUrl)
                                              │ redirect
                       GET /api/v1/auth/callback (backend) ─▶ FRONTEND_RESULT_URL
                                              │
                                      Resultado (016) ── polling GET /payments/{id}
                                                         hasta isFinal (spec 009)
```

El agente (017/018) entra al mismo flujo en el paso de **Confirmación**: su
tool crea el pago y la app muestra la tarjeta de confirmación con el quote; el
usuario la aprueba igual que un pago manual.

## Dependencias con el backend

Endpoints que ya están especificados en el backend:

| Endpoint | Spec backend | Lo usa |
|---|---|---|
| `POST /api/v1/payments` | 007 | 015, 017 |
| `GET /api/v1/auth/callback` → `FRONTEND_RESULT_URL` | 007 | 016 |
| `GET /api/v1/payments/{id}` (`isFinal`, `Retry-After`) | 008, 009 | 016 |
| `GET /api/v1/transactions` | 008 | 013 |

Endpoints que el front necesita y **todavía no tienen spec en el backend**
(se agregan al backlog del [KANBAN del backend](../../backend/docs/KANBAN.md)):

| Necesidad | Propuesta de contrato | Lo usa |
|---|---|---|
| Registro de usuario | `POST /api/v1/users` `{ name, email, walletAddress, pin }` → `201 { user, token }`; valida que la wallet exista | 011 |
| Inicio de sesión | `POST /api/v1/sessions` `{ email, pin }` → `200 { user, token }`; bloqueo tras intentos fallidos | 012 |
| Usuario actual / eliminar cuenta | `GET /api/v1/users/me` · `DELETE /api/v1/users/me` | 012 |
| Autenticación de la app | `Authorization: Bearer <token>` en vez de `x-api-key` | todos |
| Directorio de comercios | `GET /api/v1/merchants?query=&category=` → `{ items: [{ id, name, category, walletAddress, logoUrl, referenceLabel }] }` | 014 |
| Validación de una wallet | `GET /api/v1/wallets/verify?walletAddress=` → `{ exists, publicName, assetCode, assetScale }` | 011, 014 |
| Transacciones del usuario en sesión | `GET /api/v1/transactions` toma la wallet del token (sin `walletAddress` en el query) | 013 |
| Agente | `POST /api/v1/agent/messages` `{ conversationId?, text }` → `{ conversationId, reply, actions: [...] }` (ver spec 017) | 017, 018 |

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
| Comisión TuTranqui de 0,001 % | Se muestran las comisiones que trae el quote | El backend no cobra comisión propia (decisión pendiente 2) |
| "Hablar con una persona", "Enviar comprobante a un familiar" | Fuera de alcance | Backlog |
| Pagos P2P a contactos guardados ("Andrés amigo") | Fuera de alcance de estos specs; el agente paga a comercios del directorio | Requisito: pagos de servicios a comercios registrados |

## Flujo de trabajo (SDD + TDD)

Mismas reglas que el backend ([CLAUDE.md](../../CLAUDE.md)). Los specs del
frontend viven en `frontend/docs/specs/`, se crean desde
[`backend/docs/specs/_TEMPLATE.md`](../../backend/docs/specs/_TEMPLATE.md) y
siguen la **numeración global** del proyecto (el backend va en 009, el frontend
empieza en 010) para que un número de spec nunca sea ambiguo.

Tipos de prueba en los specs del frontend:

| Tipo | Qué prueba | Herramienta |
|---|---|---|
| unit | Funciones puras, schemas, hooks | Jest |
| component | Un componente: render, interacción, accesibilidad | React Native Testing Library |
| integration | Una pantalla completa contra la API simulada | RNTL + MSW |
| manual | Lo que no se automatiza en el hackatón (Android físico, voz real) | Checklist en el spec |

## Decisiones pendientes

1. **Aprobación del plan** y de las decisiones propuestas (Expo, Jest en vez de
   Vitest, MSW, TanStack Query).
2. **Comisión TuTranqui:** ¿se cobra (como en los mockups) o solo se muestran
   las comisiones del quote? Si se cobra, requiere un spec de backend.
3. **Un spec en desarrollo por carril:** la regla dice que no se inicia otro
   spec antes de terminar el actual. Con backend y frontend en paralelo se
   propone permitir **uno en desarrollo por carril** (backend / frontend).
4. **Volver de la wallet en Android:** el backend redirige a
   `FRONTEND_RESULT_URL` (una URL web). Opciones: (a) en Android abrir la
   wallet con `expo-web-browser` y, al cerrarse, ir al resultado y consultar el
   estado por polling; (b) que el backend acepte una lista de URLs de retorno
   permitidas, incluido el deep link `tutranqui://`. Recomendación: **(a)** para
   el hackatón, no cambia el backend.
5. **Mockups en el repo:** el HTML pesa 5 MB. ¿Se versiona (p. ej. en
   `frontend/docs/mockups/`) o se deja fuera del repo?
