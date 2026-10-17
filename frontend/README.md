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

## Correr el frontend sin el backend

Para ver la app completa sin el backend real (que necesita llaves de Open Payments), use la API
simulada `scripts/mock-api.mjs`. Sigue los contratos de `backend/openapi.yaml` y guarda todo en
memoria (registro, vinculación de la wallet, pagos y chat).

```bash
pnpm mock-api      # terminal 1: API simulada en http://localhost:3001/api/v1
pnpm web           # terminal 2: app web en http://localhost:8081
```

La app lee la URL de la API de `.env.local` (no versionado; ya viene apuntando a `localhost:3001`).
Si quiere apuntar al backend real, cambie `EXPO_PUBLIC_API_BASE_URL` ahí. Todo lo que empieza con
`EXPO_PUBLIC_` queda dentro del bundle: **no ponga secretos** (la app no usa la API key del backend).

## Cómo se prueba

- Los tests usan **MSW** (`tests/msw/`) con los contratos del backend: no necesitan el backend.
- `renderWithProviders` (`tests/utils/render.tsx`) monta la pantalla con TanStack Query.
- RNTL 14 es asíncrono: `await render(...)`, `await fireEvent.press(...)`.
- `msw` está fijado en 2.10.x porque las versiones posteriores traen dependencias ESM que Jest no carga.
- Passkeys: en esta fase funcionan desde Chrome (en Android, abra la app web en Chrome); los
  passkeys en app nativa son deuda técnica del backend (TD-003).

## Estructura

Ver [PLAN.md](docs/PLAN.md#estructura-del-frontend). Alias `@/` apunta a `src/`.
