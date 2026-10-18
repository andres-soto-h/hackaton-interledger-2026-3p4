#!/usr/bin/env bash
# Despliega TODO Tranqui (frontend hosting, backend, agente y frontend) en orden.
# Idempotente: se puede repetir. Ver backend/docs/REPLICAR-INFRA.md.
# Nunca contiene secretos: los pide por variable de entorno o por prompt.
set -euo pipefail

# ------------------------------- Variables -----------------------------------
STAGE="${STAGE:-dev}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export CDK_DEFAULT_REGION="$AWS_REGION"
# Perfil con permisos de administración (bootstrap, políticas IAM). Solo se usa en esos pasos.
ADMIN_PROFILE="${ADMIN_PROFILE:-drive-backup-admin}"
# Perfil que ejecuta cdk deploy / s3 sync. En una cuenta nueva sin usuario deployer: DEPLOY_PROFILE=$ADMIN_PROFILE
DEPLOY_PROFILE="${DEPLOY_PROFILE:-tranqui-deployer}"
SKIP_IAM="${SKIP_IAM:-0}"            # 1: no crear/actualizar tranqui-cfn-exec-policy
SKIP_BOOTSTRAP="${SKIP_BOOTSTRAP:-0}" # 1: no ejecutar cdk bootstrap
SKIP_SECRETS="${SKIP_SECRETS:-0}"    # 1: no pedir/cargar secretos
SKIP_AGENT="${SKIP_AGENT:-0}"        # 1: desplegar sin agente de voz
CFN_EXEC_POLICY_NAME="${CFN_EXEC_POLICY_NAME:-tranqui-cfn-exec-policy}"
# Secretos (opcionales; si faltan se piden por prompt). Open Payments: ver backend/infra/README.md.
#   OP_WALLET_ADDRESS_URL, OP_KEY_ID, OP_PRIVATE_KEY_FILE, ELEVENLABS_API_KEY
# Valores opcionales del agente: AGENT_MODEL_ID, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID
# Dominio propio del frontend (si no, se usa el de CloudFront). Requiere ajustar FrontendStack.
FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-}"
# PASSKEY_BYPASS no se usa: nunca se exporta.
unset PASSKEY_BYPASS EXPO_PUBLIC_PASSKEY_BYPASS

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA="$ROOT/backend/infra"
export STAGE
BACKEND_STACK="TranquiBackend-$STAGE"
FRONTEND_STACK="TranquiFrontend-$STAGE"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
aws_admin() { AWS_PROFILE="$ADMIN_PROFILE" aws "$@"; }
aws_dep() { AWS_PROFILE="$DEPLOY_PROFILE" aws "$@"; }
stack_output() { # stack, output key
  aws_dep cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null || true
}
cdk() { (cd "$INFRA" && AWS_PROFILE="$DEPLOY_PROFILE" pnpm exec cdk "$@"); }

# ------------------------ 1. Herramientas y credenciales ---------------------
log "1. Verificando herramientas y credenciales"
for t in aws node pnpm jq curl python3; do command -v "$t" >/dev/null || die "falta $t"; done
command -v uv >/dev/null || echo "aviso: sin uv, agent/build.sh usa pip (más lento)"
ACCOUNT_ID="$(aws_dep sts get-caller-identity --query Account --output text)" || die "credenciales inválidas para el perfil $DEPLOY_PROFILE"
export CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID"
echo "Cuenta: $ACCOUNT_ID  región: $AWS_REGION  stage: $STAGE"
read -r -p "¿Desplegar en la cuenta $ACCOUNT_ID? [s/N] " ok; [[ "$ok" == [sSyY]* ]] || die "cancelado"

# ------------------------ 2. Política IAM y bootstrap ------------------------
if [[ "$SKIP_IAM" != 1 ]]; then
  log "2a. Política IAM $CFN_EXEC_POLICY_NAME (perfil $ADMIN_PROFILE)"
  POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/$CFN_EXEC_POLICY_NAME"
  POLICY_DOC="$(sed "s/__ACCOUNT_ID__/$ACCOUNT_ID/g" "$INFRA/iam/tranqui-cfn-exec-policy.json")"
  if aws_admin iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
    # IAM admite 5 versiones: borra las no-default antes de crear otra.
    for v in $(aws_admin iam list-policy-versions --policy-arn "$POLICY_ARN" \
        --query 'Versions[?!IsDefaultVersion].VersionId' --output text); do
      aws_admin iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$v" || true
    done
    aws_admin iam create-policy-version --policy-arn "$POLICY_ARN" --set-as-default --policy-document "$POLICY_DOC" >/dev/null
  else
    aws_admin iam create-policy --policy-name "$CFN_EXEC_POLICY_NAME" --policy-document "$POLICY_DOC" >/dev/null
  fi
fi

if [[ "$SKIP_BOOTSTRAP" != 1 ]]; then
  log "2b. Bootstrap de CDK (si falta)"
  if aws_admin ssm get-parameter --name /cdk-bootstrap/hnb659fds/version >/dev/null 2>&1; then
    echo "Ya hecho bootstrap."
  else
    (cd "$INFRA" && AWS_PROFILE="$ADMIN_PROFILE" pnpm exec cdk bootstrap "aws://$ACCOUNT_ID/$AWS_REGION" \
      --cloudformation-execution-policies "arn:aws:iam::$ACCOUNT_ID:policy/$CFN_EXEC_POLICY_NAME")
  fi
fi

# ------------------------------ 3. Builds ------------------------------------
log "3. Dependencias y builds (backend, agente)"
(cd "$INFRA" && pnpm install --frozen-lockfile)
(cd "$ROOT/backend" && pnpm install --frozen-lockfile && pnpm build)
if [[ "$SKIP_AGENT" != 1 ]]; then bash "$ROOT/agent/build.sh"; else rm -rf "$ROOT/agent/dist"; fi

# --------------- 4. Hosting del frontend (da el dominio = RP ID) -------------
log "4. Stack $FRONTEND_STACK (S3 + CloudFront)"
cdk deploy "$FRONTEND_STACK" --require-approval never
BUCKET="$(stack_output "$FRONTEND_STACK" BucketName)"
DIST_ID="$(stack_output "$FRONTEND_STACK" DistributionId)"
CF_DOMAIN="$(stack_output "$FRONTEND_STACK" DistributionDomain)"
[[ -n "$BUCKET" && "$BUCKET" != None ]] || die "no se obtuvo BucketName"
FRONT_HOST="${FRONTEND_DOMAIN:-$CF_DOMAIN}"
FRONT_ORIGIN="https://$FRONT_HOST"
echo "Frontend: $FRONT_ORIGIN (bucket $BUCKET, distribución $DIST_ID)"

# ---------------- 5. Backend (+ agente), en dos pasadas si es nuevo ----------
export WEBAUTHN_RP_ID="$FRONT_HOST"
export WEBAUTHN_ORIGINS="$FRONT_ORIGIN"
export FRONTEND_RESULT_URL="$FRONT_ORIGIN/vincular/resultado"
export CORS_ALLOWED_ORIGINS="$FRONT_ORIGIN"
# PUBLIC_API_URL es la URL del propio API Gateway: no se conoce antes del primer
# despliegue. Primera pasada sin ella (y sin agente); la segunda ya la incluye.
API_URL="$(stack_output "$BACKEND_STACK" ApiUrl)"
if [[ -z "$API_URL" || "$API_URL" == None ]]; then
  log "5a. Primera pasada del backend (sin PUBLIC_API_URL ni agente: aún no existe la URL)"
  mv "$ROOT/agent/dist" "$ROOT/agent/dist.hold" 2>/dev/null || true
  unset PUBLIC_API_URL
  cdk deploy "$BACKEND_STACK" --require-approval never
  [[ -d "$ROOT/agent/dist.hold" ]] && mv "$ROOT/agent/dist.hold" "$ROOT/agent/dist"
  API_URL="$(stack_output "$BACKEND_STACK" ApiUrl)"
fi
[[ -n "$API_URL" && "$API_URL" != None ]] || die "no se obtuvo ApiUrl"
export PUBLIC_API_URL="$API_URL"
log "5b. Despliegue final del backend con PUBLIC_API_URL=$API_URL"
cdk deploy "$BACKEND_STACK" --require-approval never

# ------------------------------ 6. Secretos ----------------------------------
if [[ "$SKIP_SECRETS" != 1 ]]; then
  log "6. Secretos (se cargan solo si están vacíos; nunca se imprimen)"
  secret_empty() { # id -> 0 si no tiene valor
    ! aws_dep secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text >/dev/null 2>&1
  }
  OP_ID="tranqui/$STAGE/open-payments"
  if secret_empty "$OP_ID"; then
    : "${OP_WALLET_ADDRESS_URL:=$(read -r -p 'Wallet address URL de la plataforma: ' v; echo "$v")}"
    : "${OP_KEY_ID:=$(read -r -p 'Key ID: ' v; echo "$v")}"
    : "${OP_PRIVATE_KEY_FILE:=$(read -r -p 'Ruta del archivo de llave privada (PEM): ' v; echo "$v")}"
    [[ -f "$OP_PRIVATE_KEY_FILE" ]] || die "no existe $OP_PRIVATE_KEY_FILE"
    jq -n --arg wallet "$OP_WALLET_ADDRESS_URL" --arg keyId "$OP_KEY_ID" --rawfile pk "$OP_PRIVATE_KEY_FILE" \
      '{walletAddressUrl:$wallet,keyId:$keyId,privateKey:$pk}' \
    | aws_dep secretsmanager put-secret-value --secret-id "$OP_ID" --secret-string file:///dev/stdin >/dev/null
    echo "Cargado $OP_ID"
  else echo "$OP_ID ya tiene valor (para rotarlo, ver backend/infra/README.md)"; fi
  if [[ "$SKIP_AGENT" != 1 ]]; then
    EL_ID="tranqui/$STAGE/elevenlabs"
    if secret_empty "$EL_ID"; then
      if [[ -z "${ELEVENLABS_API_KEY:-}" ]]; then read -r -s -p 'API key de ElevenLabs: ' ELEVENLABS_API_KEY; echo; fi
      printf '%s' "$ELEVENLABS_API_KEY" | aws_dep secretsmanager put-secret-value --secret-id "$EL_ID" --secret-string file:///dev/stdin >/dev/null
      unset ELEVENLABS_API_KEY
      echo "Cargado $EL_ID"
    else echo "$EL_ID ya tiene valor"; fi
  fi
fi

# ---------------------- 7. Build y publicación del frontend ------------------
log "7. Frontend: build con EXPO_PUBLIC_API_BASE_URL=$API_URL/api/v1 y publicación"
(
  cd "$ROOT/frontend"
  pnpm install --frozen-lockfile
  rm -rf dist
  EXPO_PUBLIC_API_BASE_URL="$API_URL/api/v1" EXPO_PUBLIC_PASSKEY_BYPASS=false pnpm exec expo export -p web
)
# Primero los assets con hash (cache largo), luego el resto sin cache para ver la última versión.
aws_dep s3 sync "$ROOT/frontend/dist" "s3://$BUCKET" --delete --exclude "*.html" \
  --cache-control "public,max-age=31536000,immutable"
aws_dep s3 sync "$ROOT/frontend/dist" "s3://$BUCKET" --delete --exclude "*" --include "*.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws_dep cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null
echo "Invalidación enviada."

# ------------------------------ 8. Verificación ------------------------------
log "8. Verificación"
fail=0
check() { # nombre url
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$2" || echo 000)"
  printf '%-10s %s -> %s\n' "$1" "$2" "$code"; [[ "$code" == 200 ]] || fail=1
}
check api "$API_URL/health"
sleep 5
check frontend "$FRONT_ORIGIN/"
check frontend "$FRONT_ORIGIN/bienvenida"
[[ "$fail" == 0 ]] || die "alguna verificación falló (la distribución nueva puede tardar unos minutos: repetir)"
log "Listo. Frontend: $FRONT_ORIGIN  API: $API_URL"
echo "Pendiente a mano: acceso a modelos de Bedrock (ver backend/docs/REPLICAR-INFRA.md)."
