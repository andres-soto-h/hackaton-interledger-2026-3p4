# 001 — Bootstrap del frontend

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

10 / 11 tareas completadas en la rama `front/001` (65 tests en verde, lint, typecheck y `expo export -p web` limpios). **Solo falta la verificación manual (tarea 10)**: abrir `pnpm web` en el navegador y `pnpm android` en un emulador y revisar la pantalla base; pendiente del responsable. Desarrollo aprobado el 2026-10-17 (instrucción del responsable de avanzar el frontend).

## Contexto

Antes de construir pantallas hace falta el proyecto base: Expo con
TypeScript, navegación, pruebas, el sistema de diseño de
[DISENO.md](../DISENO.md), el cliente HTTP y la API simulada. Todos los
specs siguientes se apoyan en esto. Decisiones en [PLAN.md](../PLAN.md#decisiones).

## Alcance

**Incluye**
- Proyecto Expo + TypeScript estricto + Expo Router en `frontend/`, que corre en web y Android.
- Jest (`jest-expo`) + React Native Testing Library + MSW; helper `renderWithProviders`.
- ESLint + Prettier; scripts `test`, `lint`, `typecheck`, `web`, `android`.
- Tokens de tema y componentes base de [DISENO.md](../DISENO.md#componentes-base-srcui) que usa más de un spec: `Screen`, `AppHeader`, `Button`, `TextField`, `Card`, `AmountRow`, `StatusBadge`, `EmptyState`, `ErrorState`.
- Carga de fuentes (Lexend, Atkinson Hyperlegible).
- Cliente HTTP (`src/api/client.ts`): base URL desde `EXPO_PUBLIC_API_BASE_URL`, header `Authorization` si hay sesión, JSON, timeout y conversión del [formato de error estándar](../../../backend/docs/API.md#errores) a `ApiError { code, message, status, requestId }`.
- Utilidad de montos (`src/lib/money.ts`): formatear `{ value, assetCode }` sin `Number`.
- Layout raíz con providers (TanStack Query, tema) y las rutas `(publico)` y `(app)` vacías.
- README del frontend.

**No incluye**
- Pantallas de negocio (specs 002–009).
- Sesión y guard de rutas (spec 002).
- Despliegue de la app web.

## Criterios de aceptación

- **Dado** el repo recién clonado, **cuando** se corre `pnpm install && pnpm test`, **entonces** la suite pasa sin red.
- **Dado** `pnpm web`, **cuando** se abre en el navegador, **entonces** se ve una pantalla base con los colores y fuentes del sistema de diseño; en un ancho de 1280 px el contenido queda centrado a 480 px como máximo.
- **Dado** `pnpm android` en un emulador, **cuando** abre la app, **entonces** se ve la misma pantalla base.
- **Dado** que la API responde un error estándar, **cuando** el cliente lo recibe, **entonces** lanza `ApiError` con `code`, `status` y `requestId`.
- **Dado** que la API no responde a tiempo o no hay red, **cuando** el cliente llama, **entonces** lanza `ApiError` con `code: "NETWORK_ERROR"` o `"TIMEOUT"`.
- **Dado** el monto `{ "value": "86400.00", "assetCode": "COP" }`, **cuando** se formatea, **entonces** se muestra `$86.400` (y `US$20,00` para `{ "value": "20.00", "assetCode": "USD" }`).

## Diseño

### Cliente HTTP

```ts
type ApiError = { code: string; message: string; status: number; requestId?: string; details?: unknown }

apiClient.get<T>(path, { query?, signal? }): Promise<T>
apiClient.post<T>(path, body, { idempotencyKey? }): Promise<T>
apiClient.delete(path): Promise<void>
apiClient.setTokenProvider(() => string | null)   // lo conecta el spec 002
apiClient.onUnauthorized(handler)                  // 401 → cerrar sesión (spec 002)
```

- `idempotencyKey` se envía como `Idempotency-Key` (backend 005).
- Expone los headers de la respuesta que se necesitan (`Retry-After`, spec 007).
- Nunca registra el body de las peticiones (puede llevar credenciales de passkeys).

### Montos

`formatMoney({ value, assetCode }, { locale = "es-CO" })`: separa parte entera y
decimales del string, agrupa miles con `.` y usa `,` decimal; COP sin
decimales si son cero; símbolo por moneda (`COP → $`, `USD → US$`, otra →
código). Entradas inválidas lanzan error (no se muestran montos inventados).

`toSpokenAmount(amount)`: texto en palabras para lector de pantalla y voz
(specs 006 y 009).

### Estructura

La de [PLAN.md](../PLAN.md#estructura-del-frontend).

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `formatMoney` COP, USD, otra moneda, decimales, miles, cero | Textos esperados; nunca usa `Number` |
| 2 | unit | `formatMoney` con `value` inválido (`"1e3"`, `"abc"`, `""`) | Lanza error |
| 3 | unit | `toSpokenAmount` de `86400` COP y `20` USD | "ochenta y seis mil cuatrocientos pesos", "veinte dólares" |
| 4 | unit | Cliente: respuesta 2xx JSON | Devuelve el body tipado |
| 5 | unit | Cliente: error estándar 4xx/5xx | `ApiError` con `code`, `status`, `requestId` |
| 6 | unit | Cliente: respuesta no JSON o sin formato estándar | `ApiError` `UNKNOWN_ERROR` con el status |
| 7 | unit | Cliente: sin red / timeout | `NETWORK_ERROR` / `TIMEOUT` |
| 8 | unit | Cliente: con token provider y con `idempotencyKey` | Headers `Authorization` e `Idempotency-Key` |
| 9 | unit | Cliente: 401 | Llama al handler de `onUnauthorized` |
| 10 | component | `Button`: rol, nombre, `onPress`, `disabled`, `loading` | Accesible por rol; no dispara si está deshabilitado o cargando |
| 11 | component | `TextField`: etiqueta, error visible y anunciado | `getByLabelText` encuentra el campo; error con texto |
| 12 | component | `AmountRow`, `StatusBadge` (los 6 estados) | Texto y etiqueta accesible correctos |
| 13 | component | `Screen` en web ancho | Contenido con ancho máximo 480 |
| 14 | manual | `pnpm web` y `pnpm android` | Pantalla base visible en ambos |

## Tareas

1. [x] Crear el proyecto Expo con TypeScript estricto y Expo Router; fijar versiones.
2. [x] Configurar Jest (`jest-expo`), RNTL, MSW y `renderWithProviders`; un test de humo en verde.
3. [x] ESLint, Prettier y scripts `test`, `lint`, `typecheck`, `web`, `android`.
4. [x] Casos 1–3 en rojo → `money.ts`.
5. [x] Casos 4–9 en rojo → cliente HTTP.
6. [x] Tokens de tema y carga de fuentes.
7. [x] Casos 10–13 en rojo → componentes base.
8. [x] Layout raíz con providers y grupos de rutas `(publico)` y `(app)`.
9. [x] `.env.example` y README (cómo correr en web y Android, cómo probar).
10. [~] Verificación manual (caso 14): el build web compila; falta revisar la pantalla en el navegador y en Android.
11. [x] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Íconos | `@expo/vector-icons` (incluido en Expo) en vez de los SVG de los mockups (2026-10-17) |
| 2 | Versiones | `msw` fijado en 2.10.x (las 2.1x+ traen dependencias ESM que Jest no carga); `eslint` 9 (el plugin de React de `eslint-config-expo` aún no soporta la 10); RNTL 14 es asíncrono (`await render`, `await fireEvent`) (2026-10-17) |
| 3 | Alcance de componentes | Esta entrega trae `Screen`, `AppHeader`, `Button`, `TextField`, `Card`, `AmountRow`, `StatusBadge`, `EmptyState`, `ErrorState`, `AppText`; `StepIndicator`, `PasskeyButton`, `CheckItem`, burbujas, `MicButton` y `MerchantTile` los crea el spec que los usa primero (2026-10-17) |

## Decisiones pendientes

Ninguna.

## Notas

- Si Android necesita módulos nativos que no estén en Expo Go (p. ej. para la voz, spec 009),
  se usa un *development build*; se documenta en el README cuando llegue ese spec.
