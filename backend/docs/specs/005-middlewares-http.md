# 005 — Middlewares HTTP transversales

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Spec en borrador, pendiente de aprobación. Depende de los specs 001 y 004.

## Contexto

Todos los endpoints comparten las mismas necesidades: trazabilidad, logs sin
secretos, cabeceras de seguridad, límites al body, validación estricta e
idempotencia para no duplicar pagos. Este spec las implementa una vez, antes
de los endpoints. Lineamientos en [SEGURIDAD.md](../SEGURIDAD.md).

## Alcance

**Incluye**
- `requestId`, `httpLogger` con redacción, `securityHeaders` (helmet), `cors`,
  `jsonBody`, `validate(schema)` e `idempotency`.
- Orden de los middlewares en `createApp`.
- Schemas Zod comunes: montos, wallet addresses, descripción, paginación.
- Test de "todas las rutas protegidas exigen API key", al que cada spec de
  endpoint agrega sus rutas.

**No incluye**
- `apiKeyAuth`, `notFound` y `errorHandler` (spec 001).
- Throttling (API Gateway, spec 002).

## Criterios de aceptación

- **Dado** cualquier petición, **cuando** responde, **entonces** incluye
  `x-request-id` (el recibido si es válido o uno nuevo) y ese ID aparece en sus logs.
- **Dado** una petición con API key, tokens o parámetros del callback, **cuando**
  se registra, **entonces** el log no contiene esos valores.
- **Dado** un body mayor a 16 kb o con Content-Type distinto de JSON, **cuando**
  llega, **entonces** responde `413` o `415`.
- **Dado** un body con campos desconocidos o inválidos, **cuando** se valida,
  **entonces** responde `400 VALIDATION_ERROR` con la ruta de cada error.
- **Dado** dos `POST` con la misma `Idempotency-Key` y el mismo body, **cuando**
  llegan, **entonces** la segunda devuelve la respuesta guardada sin ejecutar
  el handler; con distinto body responde `409 IDEMPOTENCY_CONFLICT`.

## Diseño

### Orden

| # | Middleware | Responsabilidad |
|---|---|---|
| 1 | `requestId` | Usa `x-request-id` si es un UUID/ULID válido; si no, genera uno; lo devuelve en la respuesta |
| 2 | `httpLogger` (pino-http) | Método, ruta, status, duración, `requestId`. Redacta `x-api-key`, `authorization`, `idempotency-key`, tokens, `privateKey` y los query params `interact_ref` y `hash` |
| 3 | `securityHeaders` | helmet; sin `x-powered-by` |
| 4 | `cors` | Deshabilitado si `CORS_ALLOWED_ORIGINS` está vacío; si no, lista blanca exacta |
| 5 | `jsonBody` | `express.json({ limit: '16kb' })`; `415` si un método con body no envía JSON |
| 6 | `apiKeyAuth` | Spec 001 |
| 7 | `idempotency` | Solo en rutas que lo declaren (`POST`) |
| 8 | `validate(schema)` | Por ruta; Zod estricto sobre body, query y params |
| — | rutas | |
| 9 | `notFound` / `errorHandler` | Spec 001 |

### Idempotencia

- Header opcional `Idempotency-Key` (8–64 caracteres `[A-Za-z0-9_-]`).
- Registro `idem_<sha256(apiKey + ruta + key)>` en la tabla (spec 004) con el
  hash del body, el status y el body de la respuesta; TTL 24 h.
- Mientras la primera petición está en curso, una segunda con la misma key
  recibe `409 IDEMPOTENCY_CONFLICT` (evita dos pagos en paralelo).
- Solo se guardan respuestas `2xx` y `4xx`; un `5xx` permite reintentar.

### Schemas comunes

| Schema | Regla |
|---|---|
| `amount` | `{ value: string decimal positivo, assetCode: 3 letras mayúsculas }` |
| `walletAddress` | string https o `$host/path`, máx. 2048 (la validación anti-SSRF es del spec 003) |
| `description` | opcional, máx. 140 caracteres, sin caracteres de control |
| `pagination` | `limit` 1–100 (por defecto 20), `cursor` opaco |

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Petición sin `x-request-id` / con uno válido / con uno inválido | Genera / reutiliza / genera |
| 2 | Integration | Logs de una petición con `x-api-key`, `Authorization` e `Idempotency-Key` | Valores redactados |
| 3 | Integration | Logs de `GET /api/v1/auth/callback?interact_ref=x&hash=y` | Sin `x` ni `y` |
| 4 | Integration | Respuesta incluye cabeceras de helmet y no `x-powered-by` | Presentes / ausente |
| 5 | Integration | CORS vacío: preflight desde cualquier origen | Sin cabeceras CORS |
| 6 | Integration | CORS con lista: origen permitido / no permitido | Con / sin cabeceras CORS |
| 7 | Integration | Body de 17 kb | `413 PAYLOAD_TOO_LARGE` |
| 8 | Integration | `POST` con `text/plain` | `415 UNSUPPORTED_MEDIA_TYPE` |
| 9 | Integration | Body con campo desconocido / con tipo incorrecto | `400 VALIDATION_ERROR` con `details` |
| 10 | Unit | Schemas comunes con valores límite | Aceptan y rechazan según la tabla |
| 11 | Integration | Misma `Idempotency-Key` y body | Handler ejecutado una vez; misma respuesta |
| 12 | Integration | Misma `Idempotency-Key`, otro body | `409 IDEMPOTENCY_CONFLICT` |
| 13 | Integration | Misma key mientras la primera sigue en curso | `409 IDEMPOTENCY_CONFLICT` |
| 14 | Integration | Primera respuesta `5xx`, reintento con la misma key | El handler se ejecuta de nuevo |
| 15 | Integration | Tabla de rutas protegidas sin API key | `401` en cada una |

## Tareas

1. [ ] `requestId` + `httpLogger` con redacción: casos 1–3.
2. [ ] `securityHeaders` y `cors`: casos 4–6.
3. [ ] `jsonBody`: casos 7–8.
4. [ ] `validate(schema)` y schemas comunes: casos 9–10.
5. [ ] `idempotency`: casos 11–14.
6. [ ] Test de rutas protegidas (caso 15) y orden final en `createApp`.
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

Ninguna.

## Notas

- `express-rate-limit` no se usa: en Lambda cada instancia tiene su propia
  memoria, así que el límite real se pone en API Gateway (spec 002).
