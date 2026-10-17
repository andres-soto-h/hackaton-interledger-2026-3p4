# Seguridad de la API

Lineamientos de seguridad para todos los specs, organizados según el
[OWASP API Security Top 10](https://owasp.org/API-Security/). Cada punto indica
el spec que lo implementa; los que no tienen spec están en
[DEUDA-TECNICA.md](DEUDA-TECNICA.md) o son recomendaciones para producción.

Si este documento crece, se puede convertir en su propio spec.

## Autenticación de los clientes de la API

| Medida | Dónde |
|---|---|
| API key en `x-api-key`, comparada en tiempo constante; `401` sin decir si faltó o era incorrecta | Spec 001 |
| API key generada por AWS y guardada en Secrets Manager; rotación documentada | Spec 002 |
| Mecanismo más fuerte que la API key (OIDC de Google Cloud / JWT) | Deuda técnica TD-001 |
| Una API key por consumidor (agente, frontend) para revocar y auditar por separado | Recomendación |

## Autorización y abuso

| Medida | Dónde |
|---|---|
| Ningún pago se ejecuta sin aprobación del dueño de la wallet emisora (grant interactivo con límite = monto del quote) | Spec 007 |
| Máximo por pago por moneda (`MAX_PAYMENT_AMOUNTS`) y validación estricta de montos | Spec 003 |
| Riesgo: quien tenga la API key puede crear solicitudes de pago hacia cualquier wallet permitida. Mitigación: lista blanca de comercios P2M y cuotas por API key | Recomendación |

## Flujo interactivo y callback

| Medida | Dónde |
|---|---|
| Verificación del `hash` del callback en tiempo constante, nonce aleatorio | Spec 007 |
| Callback de un solo uso (actualización condicional) y TTL corto | Specs 004 y 007 |
| `paymentId` impredecible | Spec 004 |
| `finish.uri` y redirección final desde configuración, nunca desde la petición (sin *open redirect*) | Spec 007 |
| Sin tokens ni datos sensibles en URLs; `interact_ref` y `hash` fuera de los logs | Specs 005 y 007 |

## SSRF

La API hace peticiones a URLs que recibe del cliente (wallet addresses e
incoming payments). Sin control, alguien podría hacer que la Lambda llame a
servicios internos, por ejemplo al endpoint de metadata de AWS.

| Medida | Dónde |
|---|---|
| Solo `https`, host en `ALLOWED_WALLET_HOSTS`, sin `localhost`, IPs privadas, link-local (`169.254.0.0/16`) ni puertos no estándar; sin seguir redirecciones a otros hosts | Spec 003 |
| Ampliar `ALLOWED_WALLET_HOSTS` a los proveedores de wallet soportados al pasar a producción | Recomendación |

## Secretos y llaves

| Medida | Dónde |
|---|---|
| Secrets Manager en AWS, archivo ignorado por git en local, fail fast si faltan | Specs 001 y 002 |
| Redacción de secretos y tokens en logs | Spec 005 |
| Reemplazar las llaves personales por las de una wallet de la plataforma, sin fondos | Spec 002 |
| Llaves distintas por entorno | Recomendación |
| Llave KMS propia (CMK) para secretos y tabla, si se requiere auditoría de uso | Recomendación |
| No usar la cuenta **root** de AWS para desplegar: usuario o rol IAM con MFA y permisos mínimos | Recomendación (urgente) |

## Datos y tokens

| Medida | Dónde |
|---|---|
| Tokens de Open Payments guardados solo mientras el pago está activo; revocados y borrados al llegar a un estado final | Specs 004 y 008 |
| `description` de máximo 140 caracteres, sin caracteres de control, tratada solo como texto | Spec 005 (schemas) |
| Cifrado en reposo de DynamoDB (activo por defecto) | Spec 002 |
| No guardar datos personales más allá de las wallet addresses | Spec 004 |

## Validación de entrada y consumo de recursos

| Medida | Dónde |
|---|---|
| Zod estricto en todos los endpoints (rechaza campos desconocidos) | Spec 005 |
| Body máximo 16 kb, solo JSON, paginación máxima de 100 | Specs 005 y 008 |
| Timeouts a Open Payments; reintentos solo en lecturas | Spec 003 |
| `Idempotency-Key` para evitar pagos duplicados | Spec 005 |
| Throttling en API Gateway (rate y burst) | Spec 002 |

## Transporte, cabeceras y errores

| Medida | Dónde |
|---|---|
| HTTPS obligatorio (API Gateway solo expone HTTPS) | Spec 002 |
| helmet, sin `x-powered-by`, CORS deshabilitado por defecto | Spec 005 |
| Respuestas sin stack ni detalles internos | Spec 001 |
| `requestId` en respuestas y logs | Spec 005 |

## Monitoreo

| Medida | Dónde |
|---|---|
| Alarmas de CloudWatch: tasa de `5xx`, picos de `401` (posible fuerza bruta) y de `CALLBACK_INVALID` (posible manipulación) | Spec 002 |

## Cadena de suministro

| Medida | Dónde |
|---|---|
| Lockfile versionado; revisar dependencias nuevas antes de agregarlas | Todos |
| `pnpm audit` en CI y Dependabot/Renovate | Recomendación (cuando exista CI) |
