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

## Cuentas de usuario y panel de administración

| Medida | Dónde |
|---|---|
| Passkeys (WebAuthn) con verificación del usuario obligatoria; la API guarda solo llaves públicas | Spec 019 |
| Challenge aleatorio, de un solo uso y con TTL de 5 min; origen y rpID exactos; contador verificado | Spec 019 |
| JWT HS256 con algoritmo fijo, `iss`/`aud`/`exp`, secreto en Secrets Manager; la cuenta se verifica en cada petición | Spec 019 |
| Reautenticación para borrar la cuenta; corte de sesiones al bloquear o restablecer | Specs 019 y 021 |
| Wallet de la cuenta sin verificar | Deuda técnica TD-002 |
| Panel con cookie `HttpOnly`, `Secure`, `SameSite=Strict`, CSRF, `Origin` verificado y bloqueo por intentos fallidos | Spec 020 |
| HTML escapado por defecto, CSP estricta, CSS externo con SRI | Spec 020 |
| Panel desactivable con `ADMIN_ENABLED=false`; ningún secreto visible ni editable | Spec 020 |
| Configuración editable validada (anti-SSRF) y con historial de cambios | Spec 020 |
| Clave de administrador compartida | Deuda técnica TD-005 |
| Registro de actividad sin tokens, nonces ni llaves (campos permitidos por evento) | Specs 020 y 022 |

## Autorización y abuso

| Medida | Dónde |
|---|---|
| El dueño de la wallet aprueba en su proveedor un tope diario (grant interactivo con `debitAmount` + `interval`); Open Payments no deja gastar más | Spec 023 |
| Riesgo: con un permiso preaprobado, quien pueda crear pagos puede gastar el monto diario de un usuario. Mitigación: crear y confirmar pagos exige la sesión del propio usuario; el emisor sale de la sesión, nunca del body; la API key no puede pagar | Spec 007 |
| Confirmación de cada pago con el passkey del usuario (para que ni el agente ni una sesión robada puedan pagar) | Spec 007 |
| Reserva atómica del monto diario (pago + comisión) antes de mover dinero | Specs 007, 023 y 024 |
| El usuario puede revocar el permiso en su wallet o en la app; borrar la cuenta cancela el grant | Specs 019 y 023 |
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
| Solo `https`, host del proveedor (`WALLET_PROVIDER_BASE_URL`) o en `ALLOWED_WALLET_HOSTS`, sin `localhost`, IPs privadas, link-local (`169.254.0.0/16`) ni puertos no estándar; sin seguir redirecciones a otros hosts | Spec 003 |
| Ampliar `ALLOWED_WALLET_HOSTS` a los proveedores de wallet soportados al pasar a producción | Recomendación |

## Secretos y llaves

| Medida | Dónde |
|---|---|
| Secrets Manager en AWS, archivo ignorado por git en local, fail fast si faltan | Specs 001 y 002 |
| Redacción de secretos y tokens en logs | Spec 005 |
| Reemplazar las llaves personales por las de una wallet de la plataforma, sin fondos | Spec 002 |
| Llaves distintas por entorno | Recomendación |
| Llave KMS propia (CMK) para secretos y tabla, si se requiere auditoría de uso | Recomendación |
| No usar la cuenta **root** de AWS para desplegar: usuario o rol IAM con MFA y permisos mínimos | Usuario `tranqui-deployer` (ver [Permisos de despliegue](#permisos-de-despliegue-aws)); falta MFA |

## Agente de IA y voz (spec 028)

- **El agente nunca confirma pagos.** No existe una tool de confirmación y confirmar exige la firma del
  passkey del usuario, que el agente no tiene. Como máximo deja un pago en `AWAITING_CONFIRMATION`.
- **El agente actúa como el usuario, no por encima de él.** Sus tools llaman a la API con el token de
  sesión del usuario, así que aplican el tope por pago, el monto diario, la comisión, solo COP en comercios
  y la wallet vinculada. Un modelo manipulado no puede hacer más que el usuario desde la app.
- **Las acciones que ve la app las arma el código, no el modelo.** El `paymentId` sale del resultado de
  `POST /payments`; si el modelo escribe otro en su texto, se ignora. Lo que el usuario aprueba es lo que
  dice la API (pantalla 006), no lo que dice el LLM.
- **El pago usa la wallet y el monto del directorio**, nunca los que escriba el usuario o el modelo; un
  comercio con monto fijo siempre cobra ese monto.
- **Inyección de instrucciones** (en lo que escribe el usuario o en nombres de comercios): se mitiga con
  límites duros fuera del modelo (tools mínimas, validación en la API, passkey), no con el prompt.
  Los resultados de las tools se tratan como datos y los textos de terceros se recortan.
- **El token del usuario** viaja solo en el payload de invocación (API → Lambda del agente), no se guarda
  ni se registra. La Lambda del agente no tiene URL pública: solo la API puede invocarla.
- **Tercero: ElevenLabs.** Solo recibe el texto de la respuesta del agente (comercio y monto), nunca
  documentos, credenciales ni el token. La llave está en Secrets Manager (`tranqui/<stage>/elevenlabs`) y
  solo la lee la Lambda del agente. Si falla, la respuesta de texto se entrega igual.
- **Costo y abuso:** límite de 20 mensajes por minuto y usuario (en memoria por instancia: no es una cuota
  global), máximo de 6 llamadas a tools por turno, tokens de salida acotados y la limitación (throttling) del API Gateway.
- **Registros:** solo `userId`, `conversationId`, tools que dejaron acciones y duración; nunca el texto de la
  conversación ni el token.
- **Permisos de Bedrock:** la Lambda del agente solo puede `InvokeModel`/`InvokeModelWithResponseStream`
  sobre modelos Anthropic y perfiles de inferencia de la cuenta.

## Permisos de despliegue (AWS)

Cuenta `340464868186`, región `us-east-1`. El despliegue con CDK usa dos niveles de permisos:

| Medida | Dónde |
|---|---|
| Usuario IAM `tranqui-deployer` (perfil local del mismo nombre) para desplegar. Solo puede asumir los roles `deploy`, `file-publishing`, `image-publishing` y `lookup` del bootstrap de CDK, leer y escribir valores de los secretos `tranqui/*` y consultar los stacks y logs `TranquiBackend-*`. No puede asumir el rol de ejecución de CloudFormation | Política inline `tranqui-deploy-scope` |
| El rol de ejecución de CloudFormation del bootstrap usa la política administrada `tranqui-cfn-exec-policy` en lugar de `AdministratorAccess`. Solo opera sobre recursos `TranquiBackend-*` (Lambda, DynamoDB, logs, alarmas, roles IAM), secretos `tranqui/*`, HTTP APIs y el bucket de assets de CDK. A los roles solo se les puede adjuntar `AWSLambdaBasicExecutionRole` y solo se pueden pasar a Lambda | Spec 002 (tarea 22) |
| Un recurso nuevo en el stack necesita que su nombre empiece por `TranquiBackend-` (o `tranqui/` si es un secreto) y, si es de un servicio nuevo, ampliar `tranqui-cfn-exec-policy` antes de desplegar | Spec 002 |
| El usuario administrador (`drive-backup-admin`) solo se usa para preparar la cuenta, no para desplegar | Regla de operación |
| **Riesgo aceptado (2026-10-16):** `tranqui-cfn-exec-policy` permite `iam:PutRolePolicy` sobre los roles `TranquiBackend-*`, e IAM no puede limitar el contenido de una política inline. Un template malicioso o con un error podría darle a la Lambda permisos más amplios que el scope del proyecto. Se acepta durante el hackathon. Mitigación futura: permissions boundary obligatorio en los roles del stack (aspecto de CDK + condición `iam:PermissionsBoundary` en la política) | Recomendación |
| MFA para el usuario de despliegue o credenciales temporales (IAM Identity Center) en lugar de access keys de larga duración | Recomendación |

## Datos y tokens

| Medida | Dónde |
|---|---|
| Access token de la vinculación cifrado con AES-256-GCM (llave en Secrets Manager, `linkId` como dato asociado); nunca en respuestas, logs ni eventos | Spec 023 |
| Rotación del token antes de vencer; cancelación del grant al desvincular o borrar la cuenta | Spec 023 |
| Los pagos no guardan tokens | Spec 004 |
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
