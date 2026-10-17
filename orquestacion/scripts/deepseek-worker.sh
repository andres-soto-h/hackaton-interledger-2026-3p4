#!/usr/bin/env bash
# Lanza y gestiona workers de DeepSeek (OpenCode, agente backend-worker), uno por
# spec, cada uno en su propio git worktree. Lo usa el orquestador (Claude Code).
# Detalle del setup en orquestacion/README.md.
#
#   deepseek-worker.sh prepare <NNN> [base]            crea el worktree y la rama spec/NNN sin lanzar el worker
#   deepseek-worker.sh start <NNN> <brief.md> [base]   crea el worktree (si falta) y lanza el worker
#   deepseek-worker.sh continue <NNN> <texto|archivo>  sigue la sesión del worker con feedback
#   deepseek-worker.sh sync                            copia la memoria compartida a todos los worktrees
#   deepseek-worker.sh status                          estado de los specs activos
#   deepseek-worker.sh proposals                       propuestas de decisión de cada worker
#   deepseek-worker.sh close <NNN> [--force]           quita el worktree (la rama se conserva)
#
# Variables: ORQ_AGENT (coder | test-writer, por defecto coder), ORQ_MODEL
# (p. ej. deepseek/deepseek-flash), ORQ_WORKTREES, ORQ_MAX_SPECS.

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)")
orq="$repo/orquestacion"
memoria="$orq/MEMORIA-COMPARTIDA.md"
runs="$orq/runs"
wt_root="${ORQ_WORKTREES:-$(dirname "$repo")/$(basename "$repo")-worktrees}"
max_specs="${ORQ_MAX_SPECS:-5}"
# El agente se toma del checkout principal para que no dependa de la rama del worktree.
export OPENCODE_CONFIG_DIR="$repo/.opencode"

die() { echo "error: $*" >&2; exit 1; }

check_spec() { [[ "${1:-}" =~ ^[0-9]{3}$ ]] || die "spec inválido '${1:-}' (se espera NNN)"; }

wt_of() { echo "$wt_root/spec-$1"; }

active_specs() {
  git -C "$repo" worktree list --porcelain \
    | sed -n "s|^worktree $wt_root/spec-\([0-9]\{3\}\)$|\1|p"
}

running() {
  local pid_file="$runs/$1/pid"
  [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

sync_one() {
  local wt
  wt=$(wt_of "$1")
  mkdir -p "$wt/.orquestacion"
  cp "$memoria" "$wt/.orquestacion/MEMORIA.md"
  touch "$wt/.orquestacion/PROPUESTAS.md"
}

ensure_worktree() {
  local spec=$1 base=${2:-HEAD} wt
  wt=$(wt_of "$spec")
  if [ ! -d "$wt" ]; then
    local count
    count=$(active_specs | grep -c . || true)
    [ "$count" -lt "$max_specs" ] \
      || die "ya hay $count specs en paralelo (máximo $max_specs): $(active_specs | paste -sd' ' -)"
    mkdir -p "$wt_root"
    if git -C "$repo" show-ref --verify --quiet "refs/heads/spec/$spec"; then
      git -C "$repo" worktree add "$wt" "spec/$spec" >&2
    else
      git -C "$repo" worktree add -b "spec/$spec" "$wt" "$base" >&2
    fi
  fi
  sync_one "$spec"
  local pkg
  for pkg in backend backend/infra; do
    if [ -f "$wt/$pkg/package.json" ] && [ ! -d "$wt/$pkg/node_modules" ]; then
      (cd "$wt/$pkg" && pnpm install --frozen-lockfile --prefer-offline >&2)
    fi
  done
}

run_worker() {
  local spec=$1 msg=$2 session=${3:-} wt ts log
  wt=$(wt_of "$spec")
  running "$spec" && die "el worker del spec $spec ya está corriendo"
  mkdir -p "$runs/$spec"
  ts=$(date +%Y%m%d-%H%M%S)
  log="$runs/$spec/$ts.jsonl"
  echo $$ > "$runs/$spec/pid"
  trap 'rm -f "$runs/$spec/pid"' EXIT

  local agent="${ORQ_AGENT:-coder}"
  local model="${ORQ_MODEL:-}"
  if [ -z "$model" ]; then
    case "$agent" in
      test-writer) model="deepseek/deepseek-flash" ;;
      *) model="deepseek/deepseek-v4-pro" ;;
    esac
  fi
  local args=(run --agent "$agent" --model "$model" --format json --title "spec-$spec")
  [ -n "$session" ] && args+=(--session "$session")

  [ -f "$OPENCODE_CONFIG_DIR/agents/$agent.md" ] \
    || die "no existe el agente '$agent' en $OPENCODE_CONFIG_DIR/agents/"
  echo "worker spec $spec (agente $agent) → $wt (log: $log)" >&2
  local rc=0
  (cd "$wt" && opencode "${args[@]}" "$msg") > "$log" 2> "$log.err" || rc=$?

  local sid
  sid=$(jq -r 'select(.sessionID) | .sessionID' "$log" 2>/dev/null | head -1)
  [ -n "$sid" ] && echo "$sid" > "$runs/$spec/session"

  echo "=== spec $spec · salida $rc · sesión ${sid:-?} · costo USD $(jq -s '[.[] | .part.cost? // 0] | add' "$log" 2>/dev/null)"
  echo "--- reporte del worker"
  jq -r 'select(.type=="text") | .part.text' "$log" 2>/dev/null | tail -60
  echo "--- cambios en el worktree"
  git -C "$wt" status --short
  [ -s "$wt/.orquestacion/PROPUESTAS.md" ] && { echo "--- propuestas"; cat "$wt/.orquestacion/PROPUESTAS.md"; }
  [ "$rc" -eq 0 ] || { echo "--- stderr"; tail -20 "$log.err"; }
  return "$rc"
}

cmd=${1:-}
shift || true

case "$cmd" in
  prepare)
    spec=${1:-}; check_spec "$spec"
    ensure_worktree "$spec" "${2:-HEAD}"
    echo "$(wt_of "$spec")"
    ;;
  start)
    spec=${1:-}; brief=${2:-}; base=${3:-HEAD}
    check_spec "$spec"
    [ -f "$brief" ] || die "no existe el brief '$brief'"
    ensure_worktree "$spec" "$base"
    mkdir -p "$runs/$spec"
    cp "$brief" "$runs/$spec/brief-$(date +%Y%m%d-%H%M%S).md"
    run_worker "$spec" "$(cat "$brief")"
    ;;
  continue)
    spec=${1:-}; check_spec "$spec"
    [ -n "${2:-}" ] || die "falta el mensaje"
    [ -f "$runs/$spec/session" ] || die "el spec $spec no tiene sesión previa"
    sync_one "$spec"
    if [ -f "$2" ]; then msg=$(cat "$2"); else msg=$2; fi
    run_worker "$spec" "Relee .orquestacion/MEMORIA.md antes de seguir.

$msg" "$(cat "$runs/$spec/session")"
    ;;
  sync)
    for s in $(active_specs); do sync_one "$s"; echo "memoria → spec $s"; done
    ;;
  status)
    echo "worktrees en $wt_root (máximo $max_specs specs)"
    for s in $(active_specs); do
      wt=$(wt_of "$s")
      state=detenido; running "$s" && state=corriendo
      echo "· spec $s [$state] rama $(git -C "$wt" branch --show-current)" \
        "· $(git -C "$wt" status --short | grep -c . || true) archivos con cambios" \
        "· sesión $(cat "$runs/$s/session" 2>/dev/null || echo -)"
    done
    ;;
  proposals)
    for s in $(active_specs); do
      f="$(wt_of "$s")/.orquestacion/PROPUESTAS.md"
      [ -s "$f" ] && { echo "--- spec $s"; cat "$f"; }
    done
    ;;
  close)
    spec=${1:-}; check_spec "$spec"
    running "$spec" && die "el worker del spec $spec sigue corriendo"
    if [ "${2:-}" = "--force" ]; then
      git -C "$repo" worktree remove --force "$(wt_of "$spec")"
    else
      git -C "$repo" worktree remove "$(wt_of "$spec")"
    fi
    echo "worktree del spec $spec quitado; la rama spec/$spec se conserva"
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
