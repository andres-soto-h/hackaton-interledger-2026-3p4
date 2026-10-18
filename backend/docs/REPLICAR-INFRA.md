# Replicar la infraestructura (y desmontarla)

Auditoría del 2026-10-18 de la cuenta AWS 340464868186 (us-east-1). Todo se recrea
con un solo comando: `scripts/desplegar-todo.sh` (ver "Orden").

## Inventario

| Recurso | Estado | Dónde se define |
|---|---|---|
| Stack `TranquiBackend-dev`: Lambda API (Node 22), Lambda agente (Python 3.12 arm64), HTTP API, DynamoDB `PaymentsTable` (+5 índices), 6 secretos `tranqui/dev/*`, log groups, alarmas, metric filters, permisos Bedrock del agente | En IaC (`cdk diff` sin diferencias) | `backend/infra/lib/backend-stack.ts` |
| Frontend: bucket S3 privado + distribución CloudFront (OAC, función de reescritura `/ruta` a `/ruta.html`, fallback a `index.html`) | **Estaba fuera del IaC** (creado a mano con `drive-backup-admin`); ahora en IaC | `backend/infra/lib/frontend-stack.ts` (stack `TranquiFrontend-<stage>`) |
| Política administrada `tranqui-cfn-exec-policy` (rol de ejecución de CloudFormation) | Estaba fuera del IaC; ahora versionada como plantilla, **reconstruida** desde SEGURIDAD.md y la memoria del proyecto (no se pudo leer la real) | `backend/infra/iam/tranqui-cfn-exec-policy.json` |
| Bootstrap de CDK (`CDKToolkit`, qualifier `hnb659fds`) | Manual por cuenta | script, paso 2b |
| Usuario IAM `tranqui-deployer` + política inline `tranqui-deploy-scope` | Fuera del IaC, manual (ver abajo) | no versionado |
| Acceso a modelos de Bedrock (Claude Haiku 4.5 vía perfil `us.anthropic.claude-haiku-4-5-20251001-v1:0`) | Manual (consola) | n/a |
| Valores de secretos `open-payments` y `elevenlabs` (el stack los crea vacíos) | Manual, los pide el script | script, paso 6 |
| Datos de DynamoDB | Solo datos de prueba; no se migran | n/a |

Los secretos `api-key`, `session-signing-key`, `admin-password` y `token-encryption-key` los
genera AWS al crear el stack: no hay nada que cargar.

### Limitaciones de la auditoría

El perfil `tranqui-deployer` solo lee el stack: se denegaron `cloudformation:ListStacks`,
`s3:ListAllMyBuckets`, `cloudfront:ListDistributions`, `iam:ListPolicies`,
`secretsmanager:ListSecrets`, `lambda:ListFunctions` y `ssm:GetParameter`. Por eso no se
inspeccionaron el bucket/distribución reales de CloudFront (su configuración exacta, p. ej.
cómo resuelve las rutas, es una suposición razonable en `frontend-stack.ts`), ni el contenido
real de las políticas IAM ni el estado del bootstrap. El dominio actual
`d154v9xyx3azve.cloudfront.net` se obtuvo de las variables de entorno de la Lambda.

## Orden (lo que hace `scripts/desplegar-todo.sh`)

1. Verifica herramientas (`aws node pnpm jq curl python3`, `uv` opcional) y credenciales.
2. Crea/actualiza `tranqui-cfn-exec-policy` y hace `cdk bootstrap` si falta (perfil admin).
3. Compila el backend (`pnpm build`) y empaqueta el agente (`agent/build.sh`).
4. Despliega `TranquiFrontend-<stage>` (S3 + CloudFront) y lee el dominio.
5. Despliega `TranquiBackend-<stage>` con `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`,
   `FRONTEND_RESULT_URL`, `CORS_ALLOWED_ORIGINS` y `PUBLIC_API_URL` (dos pasadas, ver abajo).
6. Carga `tranqui/<stage>/open-payments` y `tranqui/<stage>/elevenlabs` si están vacíos
   (variables `OP_WALLET_ADDRESS_URL`, `OP_KEY_ID`, `OP_PRIVATE_KEY_FILE`, `ELEVENLABS_API_KEY`,
   o prompt). No se escriben en disco ni en el repo.
7. Construye el frontend con `EXPO_PUBLIC_API_BASE_URL=<ApiUrl>/api/v1`, sincroniza a S3 e
   invalida CloudFront.
8. Verifica con `curl` `GET /health` y el frontend.

`PASSKEY_BYPASS` nunca se exporta. Variables útiles: `STAGE`, `AWS_REGION`, `ADMIN_PROFILE`
(defecto `drive-backup-admin`), `DEPLOY_PROFILE` (defecto `tranqui-deployer`), `SKIP_IAM`,
`SKIP_BOOTSTRAP`, `SKIP_SECRETS`, `SKIP_AGENT`.

## Valores que cambian en una cuenta nueva

- **Dominio del frontend** (`xxxx.cloudfront.net`): lo asigna CloudFront al crear el stack del
  frontend. Es el `WEBAUTHN_RP_ID`, así que los passkeys registrados en el dominio viejo no sirven.
  Si se usa dominio propio, hay que añadirlo a `frontend-stack.ts` (certificado ACM en us-east-1
  y alias) y pasar `FRONTEND_DOMAIN`.
- **URL del API** (`xxxx.execute-api...`): la asigna API Gateway. Ciclo de dependencia:
  `PUBLIC_API_URL` (callback de Open Payments y `API_BASE_URL` del agente) es la URL del propio
  API, que depende de su Lambda; el frontend necesita esa URL para compilar, y el backend
  necesita el dominio del frontend. Se resuelve así: frontend hosting primero (da el dominio),
  backend en una primera pasada sin `PUBLIC_API_URL` ni agente (da la URL del API), segunda
  pasada con `PUBLIC_API_URL` y el agente (el stack lanza error si hay agente sin esa URL), y
  al final se compila y publica el contenido del frontend. En despliegues siguientes la URL ya
  existe y todo se hace en una sola pasada.
- **ID de cuenta**: se lee de las credenciales; la plantilla IAM usa `__ACCOUNT_ID__`.
- **Wallet de la plataforma en Open Payments**: la llave del secreto `open-payments` pertenece a
  una wallet de prueba; si ya no existe hay que crear otra y registrar su `keyId`.

## Pasos manuales que quedan

1. **Bedrock**: habilitar el acceso al modelo Claude Haiku 4.5 (y la región de su perfil de
   inferencia `us.`) en la consola de Bedrock de la cuenta nueva. Sin esto el agente falla.
2. **Usuario deployer** (opcional): `tranqui-deployer` con la política inline `tranqui-deploy-scope`
   (asumir los roles de bootstrap de CDK excepto el de cfn-exec, leer valores de `tranqui/*`,
   leer stacks y logs `TranquiBackend-*`, y ahora los del frontend: `s3:*` sobre `tranquifrontend-*`
   y `cloudfront:CreateInvalidation`). En una cuenta nueva basta con un perfil admin para
   ambos roles: `ADMIN_PROFILE=x DEPLOY_PROFILE=x`.
3. **Cuotas/servicios**: cuenta con acceso a CloudFront (cuentas nuevas a veces requieren verificación).
4. Llaves de Open Payments y API key de ElevenLabs (ver paso 6).

## Desmontar

1. Vaciar el bucket del frontend: `aws s3 rm s3://<bucket> --recursive` (el nombre sale del output
   `BucketName` de `TranquiFrontend-<stage>`).
2. `cd backend/infra && pnpm exec cdk destroy TranquiFrontend-dev TranquiBackend-dev`.
   Los secretos quedan en periodo de recuperación (7 a 30 días); para liberar el nombre:
   `aws secretsmanager delete-secret --secret-id tranqui/dev/<x> --force-delete-without-recovery`.
3. Opcional: `CDKToolkit` (bucket de assets vacío primero), `tranqui-cfn-exec-policy` y el usuario deployer.
