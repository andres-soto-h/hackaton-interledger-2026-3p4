# 002 — Infraestructura: despliegue del backend en AWS Lambda (IaC)

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 (con observación: autenticación por API key) |
| Desarrollo aprobado | 2026-10-16 |
| Finalizado | — |

## Estado

9 / 22 tareas completadas. Plantilla IaC lista en `backend/infra/`: 10/10 tests
en verde, typecheck y `cdk synth` correctos. Pendiente: cambios aprobados el
2026-10-16 (tabla de pagos con índices, throttling, configuración y alarmas),
reemplazo de llaves por las de la wallet de la plataforma y despliegue en `dev` (requiere el spec [001](001-bootstrap-api.md)).
El despliegue está bloqueado por la tarea 22: reparar el bootstrap de CDK de la cuenta, pendiente de autorización.

> 2026-10-16: aprobados los cambios que piden los specs de la API (003–009).
> La evaluación de JWT pasó a deuda técnica ([TD-001](../DEUDA-TECNICA.md#td-001--autenticación-de-la-api-más-fuerte-que-la-api-key)).

> Renumerado de 001 a 002 el 2026-10-16: el bootstrap de la API pasa a ser el 001.
> El cargador de secretos y el middleware de API key se movieron al spec 001.

## Contexto

El backend (API de pagos P2P/P2M, ver [PLAN.md](../PLAN.md)) se despliega en AWS
como una función Lambda. Los recursos se definen en una plantilla de
Infraestructura como Código (IaC) versionada en el repo, para que cualquier
miembro del equipo pueda desplegar el mismo entorno de forma reproducible.

La API será consumida desde Google Cloud (carpeta `agent`), así que debe exigir
autenticación. En esta fase se usa una **API key enviada en un header**; más
adelante se evaluará un mecanismo más seguro (p. ej. JWT).

Hoy las llaves privadas de Open Payments son las de la wallet personal del
responsable del proyecto. La API necesita **una sola identidad de cliente**: una
wallet de la plataforma, sin fondos, creada solo para registrar sus llaves. Los
comercios y personas no entregan llaves: reciben con grants no interactivos y
pagan aprobando un grant interactivo en su wallet
([API.md — Identidad de la API](../API.md#identidad-de-la-api-cliente-open-payments)).
La llave se guarda en un servicio de secretos, nunca en el código ni en la imagen de la Lambda.

## Alcance

**Incluye**
- Plantilla IaC con todos los recursos del backend.
- Función Lambda que ejecuta la app Express a través de `src/lambda.ts`.
- API Gateway (HTTP API) que expone los endpoints públicamente, incluido el
  callback de grants de Open Payments.
- Autenticación de la API por API key en el header `x-api-key`.
- Tabla de pagos con el diseño del spec [004](004-persistencia-pagos.md): estado
  del flujo de autorización (Lambda no conserva memoria entre invocaciones),
  índice de pagos y solicitudes por wallet, y registros de idempotencia.
- Throttling de API Gateway.
- Configuración de la Lambda que piden los specs de la API.
- Alarmas de CloudWatch de [SEGURIDAD.md](../SEGURIDAD.md#monitoreo).
- Almacenamiento seguro de las llaves privadas y de la API key, y su lectura
  desde la Lambda.
- Permisos IAM de mínimo privilegio.
- Logs en CloudWatch con retención definida.
- Tests de la plantilla IaC.
- Documentación de cómo desplegar y destruir el entorno.

**No incluye**
- Pipeline de CI/CD (spec aparte si se necesita).
- Dominio propio / certificados.
- Infraestructura del frontend y de `agent`.
- Múltiples entornos (se despliega un solo entorno `dev` para el hackatón).
- Autenticación más fuerte que la API key: deuda técnica TD-001.

## Criterios de aceptación

- **Dado** el repositorio con la plantilla IaC, **cuando** se ejecuta el comando
  de despliegue documentado, **entonces** se crean todos los recursos y se
  obtiene la URL pública de la API.
- **Dado** el entorno desplegado, **cuando** se llama `GET /health` en la URL
  pública, **entonces** responde `200` sin necesidad de API key.
- **Dado** una petición a un endpoint protegido, **cuando** no trae el header
  `x-api-key` o trae un valor incorrecto, **entonces** responde `401` y no
  ejecuta la lógica del endpoint.
- **Dado** una petición a un endpoint protegido con la API key correcta,
  **cuando** llega a la API, **entonces** se procesa normalmente.
- **Dado** el callback de Open Payments (`GET /api/v1/auth/callback`), **cuando**
  la wallet redirige el navegador del usuario, **entonces** se acepta sin API key
  (un redirect del navegador no puede enviar headers propios).
- **Dado** el entorno desplegado, **cuando** la Lambda necesita firmar peticiones
  a Open Payments o validar la API key, **entonces** obtiene los valores del
  servicio de secretos y no aparecen en el código, en variables de entorno en
  texto plano ni en el paquete desplegado.
- **Dado** un grant interactivo iniciado en una invocación, **cuando** el
  callback llega en otra invocación, **entonces** el estado del grant se recupera
  de la tabla persistente.
- **Dado** el rol IAM de la Lambda, **cuando** se revisa la plantilla,
  **entonces** solo tiene permisos sobre sus propios recursos (sus secretos, su
  tabla y sus logs).
- **Dado** el comando de destrucción documentado, **cuando** se ejecuta,
  **entonces** se eliminan los recursos del entorno.

## Diseño

```
Google Cloud (agent) ──HTTPS + x-api-key──▶ API Gateway (HTTP API)
Wallet (redirect)    ──HTTPS──────────────▶        │
                                                   ▼
                                  Lambda (Node.js, app Express)
                                  [middleware de API key]
                             │            │             │
                             ▼            ▼             ▼
                     Secrets Manager   DynamoDB     CloudWatch Logs
                     (llaves OP,       (pagos,        + alarmas
                      API key)          índices, TTL)
                             │
                             ▼
                   Open Payments (Interledger test network)
```

| Recurso | Propósito | Notas |
|---|---|---|
| Lambda | Ejecuta la API | Runtime Node.js 22; el código se pasa como propiedad del stack |
| API Gateway HTTP API | Expone la API | Ruta proxy `ANY /{proxy+}`; su URL es el `finish.uri` del grant |
| DynamoDB | Pagos, solicitudes e idempotencia | On-demand; TTL en `expiresAt`; índices `bySender` (`senderWalletAddress` + `createdAt`) y `byReceiver` (`receiverWalletAddress` + `createdAt`) |
| Throttling | Limitar abuso | Stage por defecto de la HTTP API: rate 10 req/s, burst 20 (configurables) |
| Alarmas CloudWatch | Detectar fallas y abuso | `5xx` de la API, picos de `401` y de `CALLBACK_INVALID` (métricas desde los logs) |
| Índices adicionales | Usuarios, eventos y panel (specs 019–022) | `byType` (`entityType` + `createdAt`), `byUser` (`userId` + `createdAt`), `byPayment` (`paymentId` + `createdAt`) |
| Secret `open-payments` | Wallet address, key ID y llave privada del cliente (wallet de la plataforma) | JSON; el valor se carga a mano, nunca en la plantilla |
| Secret `api-key` | API key de los clientes de la API | Generado por AWS al crear el stack |
| Secret `session-signing-key` | Firma de las sesiones JWT de usuarios y administrador (specs 019 y 020) | Generado por AWS (64 caracteres) |
| Secret `admin-password` | Clave del panel de administración (spec 020) | Generado por AWS |
| Secret `token-encryption-key` | Llave AES-256 para cifrar los tokens de las vinculaciones (spec 023) | Generado por AWS (32 bytes en base64); la Lambda solo puede leerlo |
| IAM Role | Permisos de la Lambda | Solo `GetSecretValue` de sus dos secretos, CRUD en su tabla, escribir sus logs |
| CloudWatch Log Group | Logs de la Lambda | Retención de 14 días |

**Variables de entorno de la Lambda (sin secretos):** `OPEN_PAYMENTS_SECRET_ARN`,
`API_KEY_SECRET_ARN`, `PAYMENTS_TABLE_NAME`, y como propiedades del stack
`ALLOWED_WALLET_HOSTS`, `MAX_PAYMENT_AMOUNTS` y
`FRONTEND_RESULT_URL` (opcional). Para los specs 019–022: `SESSION_SECRET_ARN`,
`ADMIN_PASSWORD_SECRET_ARN`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`,
`WALLET_PROVIDER_BASE_URL` y `ADMIN_ENABLED`. Para los specs 023–024:
`TOKEN_KEY_SECRET_ARN`, `DAILY_LIMIT_TIMEZONE`, `DAILY_SPEND_LIMITS` y `FEE_PERCENTAGE`. `API_BASE_URL` no se pasa: crearía una
dependencia circular entre la Lambda y la API (ver decisión pendiente del spec 007).

### Autenticación por API key

- Header: `x-api-key`.
- Se valida en un **middleware de Express**, no en API Gateway: la HTTP API de
  API Gateway no tiene API keys nativas y las de la REST API están pensadas para
  planes de uso, no para autenticación.
- Este spec define dónde vive la key (secreto `api-key` generado por AWS). El
  middleware y su comportamiento están en el spec [001](001-bootstrap-api.md).

### Llaves privadas (dónde se guardan en el despliegue)

- **Local:** archivo `backend/keys/open-payments.json` (ignorado por git) con el mismo formato que el secreto.
- **AWS:** un secreto `tranqui/dev/open-payments` en Secrets Manager con este formato:

  ```json
  {
    "walletAddressUrl": "https://ilp.interledger-test.dev/<wallet-plataforma>",
    "keyId": "<key-id>",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n..."
  }
  ```
- La plantilla solo crea el secreto vacío. El valor se carga con la CLI de AWS
  (comando documentado en el README), así la llave nunca pasa por el repo ni
  por el template de CloudFormation.
- La Lambda lee el secreto al arrancar (cold start) y lo mantiene en memoria
  durante la vida de la instancia.

**Tests de la plantilla:** se valida el template sintetizado (recursos,
propiedades clave y políticas IAM) con `aws-cdk-lib/assertions`, sin desplegar.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | IaC | El template contiene una Lambda con runtime Node.js 22 y el handler esperado | Recurso presente con esas propiedades |
| 2 | IaC | Existe una HTTP API con ruta proxy integrada a la Lambda | Ruta `ANY /{proxy+}` hacia la Lambda |
| 3 | IaC | La tabla DynamoDB tiene TTL habilitado y billing on-demand | Propiedades presentes |
| 4 | IaC | Existen los secretos `open-payments` y `api-key`, y la Lambda solo puede leer esos dos | `secretsmanager:GetSecretValue` sobre esos ARN, sin `*` |
| 5 | IaC | La Lambda solo tiene acceso a su tabla | Política limitada al ARN de la tabla |
| 6 | IaC | Ninguna variable de entorno de la Lambda contiene un secreto | No hay llaves PEM ni la API key en texto plano |
| 7 | IaC | El log group tiene retención de 14 días | `RetentionInDays: 14` |
| 8 | IaC | El secreto `open-payments` no tiene valor definido en el template | Sin `SecretString` |
| 9 | IaC | Tabla, secretos y log group se eliminan al destruir el stack | `DeletionPolicy: Delete` |
| 10 | Manual | `GET /health` sobre la URL desplegada | `200` |
| 11 | Manual | Endpoint protegido desplegado sin API key / con API key | `401` / respuesta normal |
| 12 | IaC | La tabla tiene los índices `bySender` y `byReceiver` con `createdAt` como sort key | Índices presentes |
| 13 | IaC | El stage de la HTTP API tiene throttling configurado | `ThrottlingRateLimit` y `ThrottlingBurstLimit` |
| 14 | IaC | La Lambda recibe `PAYMENTS_TABLE_NAME` y la configuración de Open Payments | Variables presentes; sin `GRANTS_TABLE_NAME` |
| 15 | IaC | Existen las alarmas de `5xx`, `401` y `CALLBACK_INVALID` | Alarmas y filtros de métricas presentes |
| 16 | IaC | Existen los secretos `session-signing-key`, `admin-password` y `token-encryption-key`, generados, y la Lambda solo puede leerlos | Política limitada a sus ARN |
| 17 | IaC | La tabla tiene los índices `byType`, `byUser` y `byPayment` | Índices presentes |
| 18 | IaC | La Lambda recibe la configuración de passkeys, proveedor de wallets y panel | Variables presentes; sin secretos en texto plano |

## Tareas

1. [x] Decidir herramienta IaC → AWS CDK en TypeScript.
2. [x] Decidir ubicación del código de infraestructura → `backend/infra/`.
3. [x] Crear el proyecto IaC y su configuración base (pnpm, TypeScript, Vitest, CDK).
4. [x] Escribir los tests de la plantilla (casos 1–9) en rojo.
5. [x] Definir Lambda + HTTP API hasta pasar los tests 1–2.
6. [x] Definir tabla DynamoDB de grants pendientes hasta pasar los tests 3 y 5.
7. [x] Definir los secretos e IAM de mínimo privilegio hasta pasar los tests 4, 6 y 8.
8. [x] Definir log group con retención hasta pasar el test 7.
9. [x] Documentar dónde y cómo se guardan las llaves privadas en el despliegue (formato del secreto, carga, rotación) en el README.
10. [ ] **Reemplazar las llaves de la wallet personal por las de una wallet de la plataforma** (crear la wallet `tranqui-app` en la red de prueba, sin fondos; generar sus llaves y cargarlas en el secreto). Las wallets de comercios de prueba solo se crean para recibir pagos; no necesitan llaves.
11. [ ] Desplegar en `dev` y verificar los casos 10–11. *Depende del spec 001 y de la tarea 22.*
12. [ ] Documentar despliegue, destrucción y carga de secretos en el README. *Escrito en `backend/infra/README.md`; se valida al desplegar (tarea 11).*
13. [ ] Tabla de pagos: índices y renombre a `PAYMENTS_TABLE_NAME` (casos 12 y 14).
14. [ ] Throttling de API Gateway (caso 13).
15. [ ] Configuración de la Lambda para los specs de la API (caso 14).
16. [ ] Alarmas de CloudWatch (caso 15).

*Requeridas por los specs 019–024; se implementan cuando esos specs se aprueben:*

17. [ ] Secreto `session-signing-key` (caso 16, spec 019).
18. [ ] Índices `byType` y `byUser` (caso 17, spec 019).
19. [ ] Configuración de passkeys y proveedor de wallets en la Lambda (caso 18, specs 003 y 019).
20. [ ] Secreto `admin-password`, índice `byPayment` y `ADMIN_ENABLED` (casos 16–18, specs 020 y 022).
21. [ ] Secreto `token-encryption-key` y configuración del monto diario y la comisión (casos 16 y 18, specs 023 y 024).

*Preparación de la cuenta de AWS (bloquea la tarea 11):*

22. [ ] **Reparar el bootstrap de CDK con permisos limitados al proyecto** (cuenta `340464868186`, `us-east-1`, perfil `drive-backup-admin`). *Requiere autorización del responsable: borra un stack compartido de la cuenta.*
    - [x] Crear el usuario de despliegue `tranqui-deployer` con la política inline `tranqui-deploy-scope` (ver [SEGURIDAD.md](../SEGURIDAD.md#permisos-de-despliegue-aws)).
    - [x] Crear la política administrada `tranqui-cfn-exec-policy` (v2, sin hallazgos en Access Analyzer).
    - [ ] Borrar el stack `CDKToolkit`, que está roto: el bucket `cdk-hnb659fds-assets-340464868186-us-east-1` y el repositorio ECR `cdk-hnb659fds-container-assets-340464868186-us-east-1` se borraron fuera de CloudFormation y la actualización falla con `ECRRepository:NotFound`. Ningún otro stack de la cuenta lo usa.
      ```
      AWS_PROFILE=drive-backup-admin AWS_REGION=us-east-1 aws cloudformation delete-stack --stack-name CDKToolkit
      AWS_PROFILE=drive-backup-admin AWS_REGION=us-east-1 aws cloudformation wait stack-delete-complete --stack-name CDKToolkit
      ```
    - [ ] Volver a hacer el bootstrap con la política limitada:
      ```
      cd backend/infra
      AWS_PROFILE=drive-backup-admin AWS_REGION=us-east-1 pnpm exec cdk bootstrap aws://340464868186/us-east-1 \
        --cloudformation-execution-policies arn:aws:iam::340464868186:policy/tranqui-cfn-exec-policy
      ```
    - [ ] Verificar que el rol `cdk-hnb659fds-cfn-exec-role-340464868186-us-east-1` solo tiene `tranqui-cfn-exec-policy` y que `tranqui-deployer` puede asumir el rol de deploy.

~~Evaluar un mecanismo de autenticación más seguro que la API key~~ → deuda técnica TD-001.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Herramienta IaC | AWS CDK en TypeScript; tests con `aws-cdk-lib/assertions` en Vitest |
| 2 | Ubicación | `backend/infra/` (cada carpeta del repo es dueña de su documentación e infraestructura) |
| 3 | Servicio de secretos | AWS Secrets Manager |
| 4 | Organización de secretos | Un secreto con la identidad del cliente Open Payments (`tranqui/dev/open-payments`) y uno para la API key (`tranqui/dev/api-key`) |
| 5 | Autenticación de la API | API key en header `x-api-key`, validada en middleware |
| 6 | Región de AWS | `us-east-1` por defecto, configurable con `CDK_DEFAULT_REGION` |
| 7 | Cuenta y credenciales de despliegue | Cuenta `340464868186`; se despliega con el perfil `tranqui-deployer` (`AWS_PROFILE=tranqui-deployer pnpm cdk deploy`) (2026-10-16) |
| 8 | Permisos de CloudFormation | Bootstrap de CDK con `tranqui-cfn-exec-policy` (limitada a `TranquiBackend-*` y `tranqui/*`) en lugar de `AdministratorAccess`; se acepta el riesgo de `iam:PutRolePolicy` sin permissions boundary (2026-10-16, ver [SEGURIDAD.md](../SEGURIDAD.md#permisos-de-despliegue-aws)) |

## Notas

- El despliegue (tarea 11) requiere el build del backend (`backend/dist/`) con
  `lambda.handler`, que entrega el spec 001. Este spec no pasa a **Hecho** antes.
- El `finish.uri` del grant interactivo debe apuntar a la URL pública de API
  Gateway, así que la URL base de la API es configuración, no un valor fijo.
- El stack recibe el código de la Lambda como propiedad: en los tests se usa
  código inline y en el despliegue el build del backend.
