# Backend — API de pagos P2P / P2M

API en TypeScript + Express sobre [Open Payments](https://openpayments.dev). La
misma app corre en local (`src/server.ts`), en los tests y en AWS Lambda
(`src/lambda.ts`). Plan, specs y avance en [`docs/`](docs/).

## Requisitos

- Node.js 22 (ver `.nvmrc`; es el runtime de la Lambda).
- pnpm 10.

## Instalar

```bash
cd backend
pnpm install
```

## Configurar (local)

1. Copia las variables de ejemplo y define tu API key local:

   ```bash
   cp .env.example .env
   ```

   | Variable | Por defecto | Descripción |
   |---|---|---|
   | `NODE_ENV` | `development` | `development` · `test` · `production` |
   | `PORT` | `3000` | Puerto local |
   | `LOG_LEVEL` | `info` | Nivel del logger (pino) |
   | `API_KEY` | — (obligatoria) | Valor esperado en el header `x-api-key` |
   | `OPEN_PAYMENTS_KEYS_FILE` | `./keys/open-payments.json` | Credenciales de Open Payments |

2. Crea `keys/open-payments.json` con las credenciales del cliente de Open
   Payments (la carpeta `keys/` está ignorada por git; nunca subas llaves):

   ```json
   {
     "walletAddressUrl": "https://ilp.interledger-test.dev/<wallet-plataforma>",
     "keyId": "<key-id>",
     "privateKey": "-----BEGIN PRIVATE KEY-----\n..."
   }
   ```

Si falta una variable obligatoria o el archivo tiene un formato inválido, la app
no arranca y dice qué falta (sin mostrar valores).

En Lambda no se usan `.env` ni `keys/`: la app lee la API key y las credenciales
de Secrets Manager con `API_KEY_SECRET_ARN` y `OPEN_PAYMENTS_SECRET_ARN`, que
define el stack de [`infra/`](infra/). La detección es automática con
`AWS_LAMBDA_FUNCTION_NAME`.

## Correr

```bash
pnpm dev                     # http://localhost:3000, recarga al guardar
curl localhost:3000/health   # {"status":"ok"}
```

Todas las rutas exigen el header `x-api-key`, excepto `GET /health` y
`GET /api/v1/auth/callback`.

## Probar y verificar

```bash
pnpm test        # Vitest + supertest (sin red, sin AWS, sin llaves reales)
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint + Prettier (pnpm format para corregir formato)
```

### Tests contra DynamoDB Local

`pnpm test:dynamo` corre el contrato del repositorio de pagos contra DynamoDB
Local (requiere la instancia en `http://localhost:8000`). Apunta a otro endpoint
con la variable `DYNAMODB_ENDPOINT` (por defecto `http://localhost:8000`).

Con Colima + nerdctl (sin Docker; los puertos publicados con `-p` no llegan a
macOS, así que se corre con `--network host`):

```bash
nerdctl run -d --name tranqui-dynamodb --network host \
  amazon/dynamodb-local:2.6.1 -jar DynamoDBLocal.jar -inMemory -sharedDb -port 8000

cd backend
pnpm test:dynamo
```

Con Docker:

```bash
docker run -d --name tranqui-dynamodb -p 8000:8000 amazon/dynamodb-local:2.6.1 \
  -jar DynamoDBLocal.jar -inMemory -sharedDb

cd backend
pnpm test:dynamo
```

## Build

```bash
pnpm build       # esbuild → dist/lambda.js (handler: lambda.handler)
```

`dist/` es lo que despliega el stack de `infra/`.

## Estructura

```
src/
├── app.ts           createApp({ config, secrets }) → Express
├── server.ts        arranque local
├── lambda.ts        handler de AWS Lambda (serverless-http)
├── config/          env.ts (variables) · secrets.ts (archivo local / Secrets Manager)
├── modules/health/  GET /health
└── shared/          errors/ · middlewares/ · logger.ts
tests/
├── unit/
├── integration/
└── helpers/
reference/           ejemplo original de Open Payments, solo como referencia
```

Errores con formato estándar: `{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }`.
