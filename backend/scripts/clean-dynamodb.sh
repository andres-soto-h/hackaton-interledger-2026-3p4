#!/usr/bin/env bash
# Limpia todos los registros de la tabla de DynamoDB de Tranqui (dev).
# Útil para dejar la base limpia antes de una demo (registro, vinculación, pagos).
#
# Uso:
#   ./scripts/clean-dynamodb.sh              # usa la tabla de TranquiBackend-dev
#   ./scripts/clean-dynamodb.sh <tabla>      # usa una tabla concreta
#
# Variables de entorno opcionales:
#   AWS_PROFILE (por defecto: drive-backup-admin)
#   AWS_REGION  (por defecto: us-east-1)
#   STACK       (por defecto: TranquiBackend-dev)

set -euo pipefail

PROFILE="${AWS_PROFILE:-drive-backup-admin}"
REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK:-TranquiBackend-dev}"

if [ -n "${1:-}" ]; then
  TABLE="$1"
else
  TABLE=$(aws cloudformation describe-stack-resources \
    --stack-name "$STACK" \
    --profile "$PROFILE" \
    --region "$REGION" \
    --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId" \
    --output text)
  if [ -z "$TABLE" ] || [ "$TABLE" = "None" ]; then
    echo "No encontré la tabla del stack '$STACK'. Pasa el nombre como argumento." >&2
    exit 1
  fi
fi

echo "Limpiando la tabla: $TABLE (perfil $PROFILE, región $REGION)"

deleted=0
last_key=""
while :; do
  if [ -z "$last_key" ]; then
    page=$(aws dynamodb scan --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" --output json)
  else
    page=$(aws dynamodb scan --table-name "$TABLE" --profile "$PROFILE" --region "$REGION" \
      --exclusive-start-key "$last_key" --output json)
  fi

  count=$(printf '%s' "$page" | jq '.Items | length')
  if [ "$count" -eq 0 ]; then
    break
  fi

  # Genera las DeleteRequest y las manda en lotes de 25 (límite de batch-write-item).
  printf '%s' "$page" \
    | jq -c '[.Items[] | {DeleteRequest: {Key: {id: .id}}}]' \
    | jq -c '_nwise(25)' \
    | while read -r batch; do
        aws dynamodb batch-write-item \
          --profile "$PROFILE" --region "$REGION" \
          --request-items "{\"$TABLE\": $batch}" > /dev/null
      done

  deleted=$((deleted + count))
  last_key=$(printf '%s' "$page" | jq -c '.LastEvaluatedKey // empty')
  if [ -z "$last_key" ]; then
    break
  fi
done

echo "Listo: $deleted registros eliminados."
