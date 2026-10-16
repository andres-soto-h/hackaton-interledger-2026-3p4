# Infraestructura del backend (AWS CDK)

Define en TypeScript los recursos del backend en AWS. Spec:
[001 — Infraestructura AWS Lambda](../docs/specs/001-infraestructura-aws-lambda.md).

| Recurso | Nombre / detalle |
|---|---|
| Lambda | API Express (`lambda.handler` del build del backend), Node.js 22 |
| API Gateway HTTP API | `tranqui-<stage>-api`, ruta `ANY /{proxy+}` |
| DynamoDB | Grants pendientes, on-demand, TTL en `expiresAt` |
| Secrets Manager | `tranqui/<stage>/open-payments` y `tranqui/<stage>/api-key` |
| CloudWatch Logs | Logs de la Lambda, retención 14 días |

## Requisitos

- Node.js 22+ y pnpm
- AWS CLI con una sesión activa (`aws login` o `aws configure sso`). Usa un
  usuario o rol IAM, no la cuenta root.
- Haber hecho bootstrap de CDK una vez por cuenta y región:
  `pnpm exec cdk bootstrap`

## Comandos

```bash
pnpm install
pnpm test          # tests de la plantilla (no despliegan nada)
pnpm typecheck
pnpm synth         # genera el template en cdk.out/
pnpm deploy        # despliega el stack TranquiBackend-<stage>
pnpm destroy       # elimina el stack y sus recursos
```

- `STAGE` (por defecto `dev`) define el nombre del entorno.
- `CDK_DEFAULT_REGION` (por defecto `us-east-1`) define la región.
- `synth` y `deploy` empaquetan `backend/dist/`, así que primero hay que compilar
  el backend (definido en el spec de bootstrap).
- `destroy` borra también la tabla, los logs y los secretos. Secrets Manager
  los conserva en periodo de recuperación (7–30 días) antes de eliminarlos.

Al terminar, `deploy` imprime la URL pública en el output `ApiUrl`.

## Secretos

### Llaves privadas de Open Payments

**Local:** las llaves van en `backend/keys/` (ignorado por git) y se referencian
desde `backend/.env`.

**AWS:** el stack crea el secreto `tranqui/<stage>/open-payments` **sin valor**.
La llave nunca pasa por el repo ni por el template de CloudFormation. Formato:

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

Para cargarlo, arma el JSON con `jq` (escapa los saltos de línea de la llave) y
súbelo sin escribirlo a disco:

```bash
jq -n \
  --arg wallet "https://ilp.interledger-test.dev/<wallet>" \
  --arg keyId "<key-id>" \
  --rawfile pk ../keys/<merchant>.key \
  '{merchants: {"<merchant-id>": {walletAddressUrl: $wallet, keyId: $keyId, privateKey: $pk}}}' \
| aws secretsmanager put-secret-value \
    --secret-id tranqui/dev/open-payments \
    --secret-string file:///dev/stdin
```

**Rotación:** genera una llave nueva en la wallet, vuelve a ejecutar el comando
anterior y elimina la llave vieja en la wallet. La Lambda lee el secreto al
arrancar cada instancia; para forzar la lectura inmediata, vuelve a desplegar.

### API key

El stack genera la API key (40 caracteres, sin signos de puntuación). Los
clientes la envían en el header `x-api-key`. Para obtenerla:

```bash
aws secretsmanager get-secret-value \
  --secret-id tranqui/dev/api-key \
  --query SecretString --output text
```

Para rotarla, guarda un valor nuevo con `aws secretsmanager put-secret-value`,
vuelve a desplegar y entrégalo a los clientes.

`GET /health` y `GET /api/v1/auth/callback` no exigen API key.
