#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# cli.sh — Bitcoin transaction / block analyzer CLI
#
# Usage:
#   ./cli.sh <fixture.json>                         Single-transaction mode
#   ./cli.sh --block <blk.dat> <rev.dat> <xor.dat>  Block mode
###############################################################################

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

error_json() {
  local code="$1"
  local message="$2"
  printf '{"ok":false,"error":{"code":"%s","message":"%s"}}\n' "$code" "$message"
}

# --- Block mode ---
if [[ "${1:-}" == "--block" ]]; then
  shift
  if [[ $# -lt 3 ]]; then
    error_json "INVALID_ARGS" "Block mode requires: --block <blk.dat> <rev.dat> <xor.dat>"
    exit 1
  fi

  BLK_FILE="$1"
  REV_FILE="$2"
  XOR_FILE="$3"

  for f in "$BLK_FILE" "$REV_FILE" "$XOR_FILE"; do
    if [[ ! -f "$f" ]]; then
      error_json "FILE_NOT_FOUND" "File not found: $f"
      exit 1
    fi
  done

  mkdir -p "$REPO_DIR/out"
  exec node -r "$REPO_DIR/node_modules/tsx/dist/cjs/index.cjs" "$REPO_DIR/src/cli.ts" --block "$BLK_FILE" "$REV_FILE" "$XOR_FILE"
fi

# --- Single-transaction mode ---
if [[ $# -lt 1 ]]; then
  error_json "INVALID_ARGS" "Usage: cli.sh <fixture.json> or cli.sh --block <blk> <rev> <xor>"
  exit 1
fi

FIXTURE="$1"

if [[ ! -f "$FIXTURE" ]]; then
  error_json "FILE_NOT_FOUND" "Fixture file not found: $FIXTURE"
  exit 1
fi

mkdir -p "$REPO_DIR/out"
exec node -r "$REPO_DIR/node_modules/tsx/dist/cjs/index.cjs" "$REPO_DIR/src/cli.ts" "$FIXTURE"
