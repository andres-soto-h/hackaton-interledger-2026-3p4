# 001 — Bootstrap de la API

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 14 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

Antes de construir los endpoints de pagos se necesita la base del proyecto:
estructura, configuración, manejo de errores, autenticación por API key, carga
de secretos y la capacidad de correr la misma app en local, en los tests y en
AWS Lambda. Es la base sobre la que se construyen todos los demás specs, y la
que necesita el spec [002 — Infraestructura](002-infraestructura-aws-lambda.md)
para desplegar.

## Alcance

**Incluye**
- Proyecto `backend/` con pnpm, TypeScript, Vitest, supertest, ESLint y Prettier.
- Estructura de carpetas del [PLAN](../PLAN.md) (solo las carpetas que este spec usa).
- `src/app.ts`, `src/server.ts` (local) y `src/lambda.ts` (handler de AWS Lambda).
- Configuración validada desde variables de entorno.
- Manejo de errores centralizado con formato estándar y respuesta 404.
- Logger estructurado.
- Endpoint `GET /health`.
- Middleware de API key (header `x-api-key`). *Movido desde el spec 002.*
- Cargador de secretos: archivo local o Secrets Manager. *Movido desde el spec 002.*
- Build del backend en `backend/dist/` con `lambda.handler`, que usa el spec 002.
- Mover el ejemplo actual a `backend/reference/` sin modificarlo.
- README del backend: instalar, configurar, correr y probar.

**No incluye**
- Endpoints de pagos, solicitudes de pago, transacciones o callback de auth.
- Cliente de Open Payments (spec aparte).
- Repositorio de grants pendientes (se define con el spec de pagos).
- Corregir el ejemplo de referencia.

## Criterios de aceptación

- **Dado** el proyecto instalado, **cuando** se ejecuta `pnpm test`, **entonces**
  corre toda la suite y pasa.
- **Dado** la app corriendo en local, **cuando** se llama `GET /health`,
  **entonces** responde `200` con `{ "status": "ok" }` sin API key.
- **Dado** una ruta que no existe, **cuando** se llama con API key válida,
  **entonces** responde `404` con el formato de error estándar.
- **Dado** un error no controlado en un handler, **cuando** ocurre, **entonces**
  responde `500` con el formato estándar y sin exponer el stack ni detalles internos.
- **Dado** una petición a una ruta protegida sin `x-api-key` o con un valor
  incorrecto, **cuando** llega, **entonces** responde `401` sin ejecutar el handler.
- **Dado** una petición con la API key correcta, **cuando** llega, **entonces**
  pasa al handler.
- **Dado** `GET /health` o `GET /api/v1/auth/callback`, **cuando** llegan sin API
  key, **entonces** no se exige la key.
- **Dado** que falta una variable de entorno obligatoria, **cuando** la app
  arranca, **entonces** falla de inmediato indicando qué variables faltan.
- **Dado** la app corriendo en Lambda, **cuando** arranca, **entonces** lee la
  API key y las llaves de Open Payments de Secrets Manager; **dado** que corre en
  local, **entonces** las lee de `.env` y de `keys/open-payments.json`.
- **Dado** el build del backend, **cuando** la Lambda recibe un evento de API
  Gateway (HTTP API) para `GET /health`, **entonces** responde `200`.

## Diseño

### Estructura

```
backend/
├── package.json · tsconfig.json · vitest.config.ts · eslint.config.js · .prettierrc
├── .env.example · .nvmrc · README.md
├── keys/                      ← open-payments.json local (ignorado por git)
├── reference/                 ← ejemplo original, sin cambios
├── src/
│   ├── app.ts                 ← createApp({ config, secrets }) → Express
│   ├── server.ts              ← arranque local
│   ├── lambda.ts              ← handler de AWS Lambda
│   ├── config/
│   │   ├── env.ts             ← schema y validación de variables de entorno
│   │   └── secrets.ts         ← cargador de secretos local / AWS
│   ├── modules/
│   │   └── health/            ← health.routes.ts
│   └── shared/
│       ├── errors/            ← AppError, errorHandler, notFound
│       ├── middlewares/       ← apiKeyAuth
│       └── logger.ts
└── tests/
    ├── unit/
    └── integration/
```

`createApp` recibe la configuración y los secretos ya cargados (inyección de
dependencias): los tests pasan valores falsos sin tocar archivos ni AWS.

### Variables de entorno

| Variable | Local | Lambda | Descripción |
|---|---|---|---|
| `NODE_ENV` | ✓ | ✓ | `development` · `test` · `production` |
| `PORT` | ✓ | — | Puerto local (por defecto `3000`) |
| `LOG_LEVEL` | ✓ | ✓ | Nivel del logger (por defecto `info`) |
| `API_KEY` | ✓ | — | API key local |
| `OPEN_PAYMENTS_KEYS_FILE` | ✓ | — | Ruta del JSON local (por defecto `./keys/open-payments.json`) |
| `API_KEY_SECRET_ARN` | — | ✓ | ARN del secreto de la API key (lo define el spec 002) |
| `OPEN_PAYMENTS_SECRET_ARN` | — | ✓ | ARN del secreto de llaves (lo define el spec 002) |

La app detecta que corre en Lambda por la variable `AWS_LAMBDA_FUNCTION_NAME`,
que AWS define automáticamente.

### Secretos

Mismo formato en local (archivo) y en AWS (secreto), definido en el spec 002:

```json
{
  "merchants": {
    "<merchant-id>": {
      "walletAddressUrl": "https://ilp.interledger-test.dev/<wallet>",
      "keyId": "<key-id>",
      "privateKey": "-----BEGIN PRIVATE KEY-----\n..."
    }
  }
}
```

El cargador valida el formato y devuelve `{ apiKey, merchants }`. En Lambda se
lee una vez por instancia (en el cold start) y queda en memoria.

### Formato de error estándar

```json
{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }
```

| Situación | Status | `code` |
|---|---|---|
| Ruta inexistente | 404 | `NOT_FOUND` |
| API key ausente o inválida | 401 | `UNAUTHORIZED` |
| JSON mal formado | 400 | `INVALID_JSON` |
| `AppError` lanzado por el código | el definido | el definido |
| Error no controlado | 500 | `INTERNAL_ERROR` |

### API key

- Header `x-api-key`, comparación en tiempo constante (`crypto.timingSafeEqual`).
- Rutas públicas: `GET /health` y `GET /api/v1/auth/callback`.
- El `401` no indica si faltó la key o si era incorrecta.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | Integration | `GET /health` sin API key | `200`, `{ "status": "ok" }` |
| 2 | Integration | Ruta inexistente con API key válida | `404`, `NOT_FOUND` |
| 3 | Integration | Handler que lanza un error no controlado | `500`, `INTERNAL_ERROR`, sin stack en la respuesta |
| 4 | Integration | Handler que lanza un `AppError` | Status y `code` del error |
| 5 | Integration | Body con JSON mal formado | `400`, `INVALID_JSON` |
| 6 | Unit | Ruta protegida sin `x-api-key` | `401`, `UNAUTHORIZED` |
| 7 | Unit | Ruta protegida con `x-api-key` incorrecta (incluye longitud distinta) | `401`, `UNAUTHORIZED` |
| 8 | Unit | Ruta protegida con `x-api-key` correcta | Pasa al siguiente handler |
| 9 | Unit | `GET /health` y `GET /api/v1/auth/callback` sin API key | Pasan al siguiente handler |
| 10 | Unit | Configuración con todas las variables válidas | Objeto de configuración tipado con valores por defecto |
| 11 | Unit | Configuración sin variables obligatorias | Error que lista las variables faltantes |
| 12 | Unit | Cargador de secretos en local | Lee `API_KEY` y el archivo JSON |
| 13 | Unit | Cargador de secretos en Lambda (Secrets Manager mockeado) | Lee ambos secretos por ARN |
| 14 | Unit | Secreto de Open Payments con formato inválido | Error claro de formato |
| 15 | Integration | Handler de Lambda con un evento de HTTP API para `GET /health` | `statusCode: 200` |

## Tareas

1. [ ] Crear el proyecto `backend/` (package.json, tsconfig, Vitest, ESLint, Prettier, `.nvmrc`, `.env.example`).
2. [ ] Mover el ejemplo a `backend/reference/` sin modificarlo.
3. [ ] Configuración de entorno: tests 10–11 en rojo → implementación.
4. [ ] Logger estructurado.
5. [ ] Errores y 404: tests 2–5 en rojo → `AppError`, `errorHandler`, `notFound`.
6. [ ] `app.ts` + `GET /health`: test 1 en rojo → implementación.
7. [ ] Middleware de API key: tests 6–9 en rojo → implementación. *Movida desde el spec 002.*
8. [ ] Cargador de secretos: tests 12–14 en rojo → implementación. *Movida desde el spec 002.*
9. [ ] `server.ts` para correr en local.
10. [ ] `lambda.ts`: test 15 en rojo → implementación con el adaptador elegido.
11. [ ] Build del backend a `backend/dist/` con `lambda.handler`; verificar `cdk synth` del spec 002 con el build real.
12. [ ] Scripts `dev`, `test`, `lint`, `typecheck`, `build` funcionando.
13. [ ] README del backend.
14. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Adaptador Express → Lambda.** Recomendación: **`serverless-http`**: simple,
   compatible con Express 5 y con eventos de HTTP API. Alternativa:
   `@codegenie/serverless-express`.
2. **Validación de configuración y requests.** Recomendación: **Zod** (se reusa
   después para validar los bodies de los endpoints).
3. **Logger.** Recomendación: **pino** (JSON estructurado, rápido, legible en
   CloudWatch).
4. **Bundler del build.** Recomendación: **esbuild** (un solo archivo
   `dist/lambda.js` con dependencias incluidas; paquete pequeño y cold start rápido).

## Notas

- Las tareas 7 y 8 se movieron desde el spec 002 (antes 001) el 2026-10-16.
- El ejemplo en `reference/` queda fuera del build, del lint y de los tests.
