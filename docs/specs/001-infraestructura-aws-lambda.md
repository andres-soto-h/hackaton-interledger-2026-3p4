# 001 — Infraestructura: despliegue del backend en AWS Lambda (IaC)

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 13 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

El backend (API de pagos P2P/P2M, ver [PLAN.md](../PLAN.md)) se despliega en AWS
como una función Lambda. Los recursos se definen en una plantilla de
Infraestructura como Código (IaC) versionada en el repo, para que cualquier
miembro del equipo pueda desplegar el mismo entorno de forma reproducible.

Hoy las llaves privadas de Open Payments son las de la wallet personal del
responsable del proyecto. Deben reemplazarse por llaves de comercios ficticios y
guardarse en un servicio de secretos, nunca en el código ni en la imagen de la Lambda.

## Alcance

**Incluye**
- Plantilla IaC con todos los recursos del backend.
- Función Lambda que ejecuta la app Express a través de `src/lambda.ts`.
- API Gateway (HTTP API) que expone los endpoints públicamente, incluido el
  callback de grants de Open Payments.
- Tabla persistente para el estado de grants pendientes (entre `POST /payments`
  y `GET /auth/callback`), porque Lambda no conserva memoria entre invocaciones.
- Almacenamiento seguro de las llaves privadas y su lectura desde la Lambda.
- Permisos IAM de mínimo privilegio.
- Logs en CloudWatch con retención definida.
- Tests de la plantilla IaC.
- Documentación de cómo desplegar y destruir el entorno.

**No incluye**
- Pipeline de CI/CD (spec aparte si se necesita).
- Dominio propio / certificados.
- Infraestructura del frontend y de `agent`.
- Múltiples entornos (se despliega un solo entorno `dev` para el hackatón).

## Criterios de aceptación

- **Dado** el repositorio con la plantilla IaC, **cuando** se ejecuta el comando
  de despliegue documentado, **entonces** se crean todos los recursos y se
  obtiene la URL pública de la API.
- **Dado** el entorno desplegado, **cuando** se llama `GET /health` en la URL
  pública, **entonces** responde `200`.
- **Dado** el entorno desplegado, **cuando** la Lambda necesita firmar peticiones
  a Open Payments, **entonces** obtiene la llave privada del servicio de secretos
  y la llave no aparece en el código, en variables de entorno en texto plano ni
  en el paquete desplegado.
- **Dado** un grant interactivo iniciado en una invocación, **cuando** el
  callback llega en otra invocación, **entonces** el estado del grant se recupera
  de la tabla persistente.
- **Dado** el rol IAM de la Lambda, **cuando** se revisa la plantilla,
  **entonces** solo tiene permisos sobre sus propios recursos (su secreto, su
  tabla y sus logs).
- **Dado** el comando de destrucción documentado, **cuando** se ejecuta,
  **entonces** se eliminan los recursos del entorno.

## Diseño

```
Cliente / Wallet ──HTTPS──▶ API Gateway (HTTP API)
                                  │
                                  ▼
                           Lambda (Node.js, app Express)
                             │            │             │
                             ▼            ▼             ▼
                     Secrets Manager   DynamoDB     CloudWatch Logs
                     (llaves privadas) (grants      
                                        pendientes, TTL)
                             │
                             ▼
                   Open Payments (Interledger test network)
```

| Recurso | Propósito | Notas |
|---|---|---|
| Lambda | Ejecuta la API | Handler `lambda.ts`; runtime Node.js LTS; timeout y memoria a definir |
| API Gateway HTTP API | Expone la API | Su URL se usa como `finish.uri` del grant interactivo |
| DynamoDB | Estado de grants pendientes | On-demand; TTL para expirar grants no completados |
| Secrets Manager | Llaves privadas y key IDs de los comercios | Un secreto por comercio o uno con todos, a decidir |
| IAM Role | Permisos de la Lambda | Solo `GetSecretValue` de su secreto, CRUD en su tabla, escribir sus logs |
| CloudWatch Log Group | Logs de la Lambda | Retención corta (p. ej. 14 días) |

**Configuración de la Lambda (variables de entorno, sin secretos):** ARN o nombre
del secreto, nombre de la tabla, URLs de wallets, URL base pública de la API.

**Tests de la plantilla:** se valida el template sintetizado (recursos
existentes, propiedades clave y políticas IAM) sin desplegar en AWS.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | IaC | El template contiene una Lambda con runtime Node.js y el handler esperado | Recurso presente con esas propiedades |
| 2 | IaC | Existe una HTTP API con integración a la Lambda | Ruta proxy hacia la Lambda |
| 3 | IaC | La tabla DynamoDB tiene TTL habilitado y billing on-demand | Propiedades presentes |
| 4 | IaC | Existe el secreto de llaves y la Lambda solo puede leer ese secreto | Política con `secretsmanager:GetSecretValue` sobre ese ARN, sin `*` |
| 5 | IaC | La Lambda solo tiene acceso a su tabla | Política limitada al ARN de la tabla |
| 6 | IaC | Ninguna variable de entorno de la Lambda contiene una llave privada | No hay valores con formato de llave PEM |
| 7 | IaC | El log group tiene retención definida | `RetentionInDays` presente |
| 8 | Unit | El cargador de llaves lee del servicio de secretos cuando corre en Lambda y de `keys/` en local | Fuente correcta según el entorno |
| 9 | Manual | `GET /health` sobre la URL desplegada | `200` |

## Tareas

- [ ] Decidir herramienta IaC (ver *Decisiones pendientes*).
- [ ] Decidir ubicación del código de infraestructura.
- [ ] Crear el proyecto IaC y su configuración base.
- [ ] Escribir los tests de la plantilla (casos 1–7) en rojo.
- [ ] Definir Lambda + API Gateway hasta pasar los tests 1–2.
- [ ] Definir tabla DynamoDB de grants pendientes hasta pasar el test 3 y 5.
- [ ] Definir el secreto de llaves e IAM de mínimo privilegio hasta pasar los tests 4 y 6.
- [ ] Definir log group con retención hasta pasar el test 7.
- [ ] **Definir dónde y cómo se guardan las llaves privadas en el despliegue** (formato del secreto, cómo se cargan, quién las rota).
- [ ] Implementar el cargador de llaves local/AWS con su test (caso 8).
- [ ] **Reemplazar las llaves privadas de la wallet personal por las de comercios ficticios** (crear wallets de prueba, generar llaves, registrarlas y cargarlas en el secreto).
- [ ] Desplegar en `dev` y verificar `GET /health` (caso 9).
- [ ] Documentar despliegue, destrucción y carga de secretos en el README.

## Decisiones pendientes

1. **Herramienta IaC.** Opciones: AWS CDK (TypeScript), AWS SAM, Terraform,
   Serverless Framework. Recomendación: **AWS CDK en TypeScript**: mismo
   lenguaje que el backend y tests de la plantilla con `aws-cdk-lib/assertions`
   en Vitest, lo que encaja con TDD.
2. **Ubicación del código IaC.** Recomendación: `infra/` en la raíz del repo
   (podrá alojar también la infraestructura de frontend y agent). Alternativa:
   `backend/infra/`.
3. **Servicio de secretos.** Recomendación: **Secrets Manager** (rotación y
   auditoría). Alternativa más barata: SSM Parameter Store `SecureString`.
4. **Un secreto por comercio o uno compartido** con todas las llaves.
5. **Adaptador Express → Lambda:** `@codegenie/serverless-express` o `serverless-http`.
6. **Región de AWS.**

## Notas

- Depende de que exista `src/lambda.ts` y el repositorio de grants (spec de
  bootstrap del backend). Puede desarrollarse en paralelo en la parte de IaC,
  pero el despliegue completo requiere ese spec.
- El `finish.uri` del grant interactivo debe apuntar a la URL pública de API
  Gateway, así que la URL base de la API es configuración, no un valor fijo.
