# Cableado del backend (composition root)

> Actualizado: 2026-10-17 · Cómo se arma la app a partir de los módulos ya integrados.
> Variables nuevas del IaC en [specs/002](specs/002-infraestructura-aws-lambda.md).

`createApp` (middlewares transversales, spec 005) recibe una lista de routers.
`src/composition/` los construye con sus dependencias reales:

| Archivo | Qué hace |
|---|---|
| `composition/create-composition.ts` | Construye servicios y routers de cada módulo y llama a `createApp`. Recibe los adaptadores ya creados (gateway, verificador de passkeys, almacenamiento), por eso se prueba con fakes. |
| `composition/storage.ts` | `createMemoryStorage()` (local) y `createDynamoStorage()` (tabla única). `createStorage(config)` elige. |
| `composition/bootstrap.ts` | Crea los adaptadores reales (SDK de Open Payments, SimpleWebAuthn, DynamoDB) y arma la app. `server.ts` y `lambda.ts` solo llaman a `bootstrap`. |

## Módulos montados

| Módulo (spec) | Rutas | Autenticación |
|---|---|---|
| auth (019) | `POST /api/v1/auth/{register,login}/{options,verify}` | Pública (WebAuthn) |
| me (019) | `GET`/`DELETE /api/v1/me` | Sesión; al borrar la cuenta cancela el grant (023) |
| wallet-links (023) | `/api/v1/me/wallet-link`, `/api/v1/me/allowance`, `GET /api/v1/auth/callback` | Sesión; el callback es público y valida el hash |
| payment-requests (006) | `POST /api/v1/payment-requests` | API key + idempotencia |
| admin (020, 021) | `/admin/*` | Sesión del panel (cookie + CSRF), sin API key. `ADMIN_ENABLED=false` lo desmonta |
| dev (019) | `/dev/passkeys*` | **Solo runtime local**; nunca en Lambda |

| payments (007) | `POST /api/v1/payments`, `…/{id}/confirm/options`, `…/{id}/confirm`, `…/{id}/cancel` | Sesión del usuario (no API key); idempotencia, `paymentsEnabled` del panel, passkey y vinculación del 023 |

`FeeCalculator`/`FeeCollector` están cableados con las implementaciones por defecto (sin
comisión) hasta que el spec 024 las reemplace en `createComposition`. `extraRouters` sigue
disponible como punto de extensión para specs futuros.

## Variables de entorno

Local (`.env`, ver `.env.example`) y Lambda comparten los nombres salvo los secretos:

| Variable | Local | Lambda | Por defecto |
|---|---|---|---|
| `API_KEY` / `API_KEY_SECRET_ARN` | obligatoria | ARN obligatorio | — |
| `OPEN_PAYMENTS_KEYS_FILE` / `OPEN_PAYMENTS_SECRET_ARN` | archivo JSON | ARN | `./keys/open-payments.json` |
| `SESSION_SECRET` / `SESSION_SECRET_ARN` | ≥ 32 caracteres | ARN | — |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_SECRET_ARN` | ≥ 12 caracteres | ARN | — |
| `TOKEN_KEY` / `TOKEN_KEY_SECRET_ARN` | ≥ 32 caracteres (llave AES = SHA-256) | ARN | — |
| `STORAGE` | `memory` \| `dynamo` | siempre `dynamo` | `memory` |
| `PAYMENTS_TABLE_NAME` | obligatoria si `STORAGE=dynamo` | obligatoria | — |
| `DYNAMODB_ENDPOINT` | opcional (DynamoDB Local) | — | — |
| `CORS_ALLOWED_ORIGINS` | opcional | opcional | vacío (CORS desactivado) |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGINS` | opcional | opcional | `localhost`, `Tranqui`, `http://localhost:3000` |
| `ADMIN_ENABLED` | opcional | opcional | `true` |
| `FRONTEND_RESULT_URL` | opcional | opcional | vacío |
| `PUBLIC_API_URL` | opcional | opcional | local: `http://localhost:PORT`; Lambda: el dominio de la primera petición |
| `DAILY_SPEND_LIMITS`, `DAILY_LIMIT_TIMEZONE` | opcional | opcional | `USD:200`, `America/Bogota` |
| `FEE_PERCENTAGE` | opcional | opcional | `0` |
| `WALLET_PROVIDER_BASE_URL`, `ALLOWED_WALLET_HOSTS`, `MAX_PAYMENT_AMOUNTS`, `OPEN_PAYMENTS_TIMEOUT_MS` | opcional | opcional | spec 003 |

Los valores editables desde el panel (spec 020) se guardan en la tabla y **reemplazan** a
estos valores por defecto en cuanto se guardan.

Los secretos de Secrets Manager (sesión, admin, cifrado) son cadenas simples generadas por
AWS (64/32/64 caracteres); el secreto de Open Payments es el JSON `{ walletAddressUrl, keyId, privateKey }`.

## Arrancar en local

```
cd backend
cp .env.example .env        # ajusta API_KEY, SESSION_SECRET, ADMIN_PASSWORD, TOKEN_KEY
# llaves de la wallet de la plataforma en keys/open-payments.json ({ walletAddressUrl, keyId, privateKey })
pnpm dev                    # memoria; los datos se pierden al reiniciar
```

Con DynamoDB Local (Colima + nerdctl, puerto 8000) y la tabla del spec 002 creada:
`STORAGE=dynamo PAYMENTS_TABLE_NAME=<tabla> DYNAMODB_ENDPOINT=http://localhost:8000 pnpm dev`.

- Panel: `http://localhost:3000/admin/login` (contraseña `ADMIN_PASSWORD`).
- Prueba de passkeys: `http://localhost:3000/dev/passkeys`.

## Pendiente de infraestructura (spec 002, en pausa)

El IaC actual no define `CORS_ALLOWED_ORIGINS`, `PUBLIC_API_URL` ni `STORAGE`. No hacen falta
para desplegar (CORS desactivado, URL pública derivada de la petición y Lambda siempre DynamoDB),
pero conviene agregar `CORS_ALLOWED_ORIGINS` y `PUBLIC_API_URL` cuando se conozca el dominio.
