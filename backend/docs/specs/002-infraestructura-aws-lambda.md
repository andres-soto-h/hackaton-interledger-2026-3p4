# 002 — Infraestructura: despliegue del backend en AWS Lambda (IaC)

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 (con observación: autenticación por API key) |
| Desarrollo aprobado | 2026-10-16 |
| Finalizado | — |

## Estado

9 / 13 tareas completadas. Plantilla IaC lista en `backend/infra/`: 10/10 tests
en verde, typecheck y `cdk synth` correctos. Pendiente: reemplazo de llaves,
despliegue en `dev` (requiere el spec [001](001-bootstrap-api.md)) y evaluación de JWT.

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
responsable del proyecto. Deben reemplazarse por llaves de comercios ficticios y
guardarse en un servicio de secretos, nunca en el código ni en la imagen de la Lambda.

## Alcance

**Incluye**
- Plantilla IaC con todos los recursos del backend.
- Función Lambda que ejecuta la app Express a través de `src/lambda.ts`.
- API Gateway (HTTP API) que expone los endpoints públicamente, incluido el
  callback de grants de Open Payments.
- Autenticación de la API por API key en el header `x-api-key`.
- Tabla persistente para el estado de grants pendientes (entre `POST /payments`
  y `GET /auth/callback`), porque Lambda no conserva memoria entre invocaciones.
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
- Mecanismo de autenticación definitivo (JWT u otro): solo se evalúa (tarea 15).

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
                     (llaves OP,       (grants
                      API key)          pendientes, TTL)
                             │
                             ▼
                   Open Payments (Interledger test network)
```

| Recurso | Propósito | Notas |
|---|---|---|
| Lambda | Ejecuta la API | Runtime Node.js 22; el código se pasa como propiedad del stack |
| API Gateway HTTP API | Expone la API | Ruta proxy `ANY /{proxy+}`; su URL es el `finish.uri` del grant |
| DynamoDB | Estado de grants pendientes | On-demand; TTL en el atributo `expiresAt` |
| Secret `open-payments` | Llaves privadas y key IDs de los comercios | JSON; el valor se carga a mano, nunca en la plantilla |
| Secret `api-key` | API key de los clientes de la API | Generado por AWS al crear el stack |
| IAM Role | Permisos de la Lambda | Solo `GetSecretValue` de sus dos secretos, CRUD en su tabla, escribir sus logs |
| CloudWatch Log Group | Logs de la Lambda | Retención de 14 días |

**Variables de entorno de la Lambda (sin secretos):** ARN de cada secreto,
nombre de la tabla. La URL pública de la API y las URLs de wallets se definen en
el spec [001](001-bootstrap-api.md).

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
    "merchants": {
      "<merchant-id>": {
        "walletAddressUrl": "https://ilp.interledger-test.dev/<wallet>",
        "keyId": "<key-id>",
        "privateKey": "-----BEGIN PRIVATE KEY-----\n..."
      }
    }
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
10. [ ] **Reemplazar las llaves privadas de la wallet personal por las de comercios ficticios** (crear wallets de prueba, generar llaves, registrarlas y cargarlas en el secreto).
11. [ ] Desplegar en `dev` y verificar los casos 10–11. *Depende del spec 001 y de credenciales de AWS.*
12. [ ] Documentar despliegue, destrucción y carga de secretos en el README. *Escrito en `backend/infra/README.md`; se valida al desplegar (tarea 11).*
13. [ ] **Evaluar un mecanismo de autenticación más seguro que la API key (p. ej. JWT)** y proponerlo como spec.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Herramienta IaC | AWS CDK en TypeScript; tests con `aws-cdk-lib/assertions` en Vitest |
| 2 | Ubicación | `backend/infra/` (cada carpeta del repo es dueña de su documentación e infraestructura) |
| 3 | Servicio de secretos | AWS Secrets Manager |
| 4 | Organización de secretos | Un secreto con todas las llaves de comercios (`tranqui/dev/open-payments`) y uno para la API key (`tranqui/dev/api-key`) |
| 5 | Autenticación de la API | API key en header `x-api-key`, validada en middleware |
| 6 | Región de AWS | `us-east-1` por defecto, configurable con `CDK_DEFAULT_REGION` |

## Notas

- El despliegue (tarea 11) requiere el build del backend (`backend/dist/`) con
  `lambda.handler`, que entrega el spec 001. Este spec no pasa a **Hecho** antes.
- El `finish.uri` del grant interactivo debe apuntar a la URL pública de API
  Gateway, así que la URL base de la API es configuración, no un valor fijo.
- El stack recibe el código de la Lambda como propiedad: en los tests se usa
  código inline y en el despliegue el build del backend.
