# TuTranqui — frontend

App web y Android (Expo + React Native + TypeScript). Plan, diseño y specs en [`docs/`](docs/PLAN.md).

## Requisitos

Node 22+ y pnpm 10.

## Comandos

```bash
pnpm install
pnpm mock-api     # API simulada en memoria (sin backend): http://localhost:3001/api/v1
pnpm web          # navegador (Chrome): http://localhost:8081
pnpm android      # emulador o dispositivo con Expo Go
pnpm test         # Jest + RNTL + MSW, sin red
pnpm lint
pnpm typecheck
```

## Configurar la URL de la API

La app lee la URL de la API de `EXPO_PUBLIC_API_BASE_URL` (definida en `.env.local`, no versionado).
En local apunta al backend real (`http://localhost:3000/api/v1`). En AWS se define la misma variable
como entorno de build con la URL del API Gateway: no hay código ni archivo distinto por entorno.

```bash
pnpm web           # app web en http://localhost:8081 (asume el backend en localhost:3000)
```

Todo lo que empieza con `EXPO_PUBLIC_` queda dentro del bundle: **no ponga secretos** (la app no
usa la API key del backend; las rutas de la app se autentican con la sesión del usuario).

## Correr el frontend sin el backend (API simulada)

Para ver la app completa sin el backend real (que necesita llaves de Open Payments), use la API
simulada `scripts/mock-api.mjs`. Sigue los contratos de `backend/openapi.yaml` y guarda todo en
memoria (registro, vinculación de la wallet, pagos y chat).

```bash
pnpm mock-api      # terminal 1: API simulada en http://localhost:3001/api/v1
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1 pnpm web   # terminal 2
```

## Cómo se prueba

- Los tests usan **MSW** (`tests/msw/`) con los contratos del backend: no necesitan el backend.
- `renderWithProviders` (`tests/utils/render.tsx`) monta la pantalla con TanStack Query.
- RNTL 14 es asíncrono: `await render(...)`, `await fireEvent.press(...)`.
- `msw` está fijado en 2.10.x porque las versiones posteriores traen dependencias ESM que Jest no carga.
- Passkeys: en esta fase funcionan desde Chrome (en Android, abra la app web en Chrome); los
  passkeys en app nativa son deuda técnica del backend (TD-003).

## Estructura

Ver [PLAN.md](docs/PLAN.md#estructura-del-frontend). Alias `@/` apunta a `src/`.
