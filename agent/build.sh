#!/usr/bin/env bash
# Empaqueta la Lambda del agente (spec 028) en dist/package: dependencias para
# Lambda arm64 / Python 3.12 + el código de src/. Sin Docker. CDK sube esa carpeta.
# Usa `uv` si está instalado (resuelve las ruedas de Linux arm64 desde cualquier SO); si no, pip.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/package
if command -v uv >/dev/null 2>&1; then
  uv pip install -r requirements.txt \
    --target dist/package \
    --python-platform aarch64-manylinux2014 \
    --python-version 3.12 \
    --only-binary :all:
else
  python3 -m pip install -r requirements.txt \
    --target dist/package \
    --platform manylinux2014_aarch64 \
    --platform manylinux_2_17_aarch64 \
    --platform manylinux_2_28_aarch64 \
    --implementation cp \
    --python-version 3.12 \
    --only-binary=:all: \
    --upgrade
fi
cp -R src/. dist/package/
find dist/package -name '__pycache__' -type d -prune -exec rm -rf {} +
echo "Listo: agent/dist/package"
