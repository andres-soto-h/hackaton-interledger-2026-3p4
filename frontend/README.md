# TuTranqui — frontend

App web y Android (Expo + React Native + TypeScript). Plan, diseño y specs en [`docs/`](docs/PLAN.md).

## Requisitos

Node 22+ y pnpm 10.

## Comandos

```bash
pnpm install
pnpm web          # navegador (Chrome): http://localhost:8081
pnpm android      # emulador o dispositivo con Expo Go
pnpm test         # Jest + RNTL + MSW, sin red
pnpm lint
pnpm typecheck
```

Copie `.env.example` a `.env.local` y ajuste `EXPO_PUBLIC_API_BASE_URL`. Todo lo que empieza con
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
