#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# web.sh — Bitcoin transaction web visualizer
#
# Starts the web visualizer server.
#
# Behavior:
#   - Reads PORT env var (default: 3000)
#   - Prints the URL (e.g., http://127.0.0.1:3000) to stdout
#   - Keeps running until terminated (CTRL+C / SIGTERM)
#   - Must serve GET /api/health -> 200 { "ok": true }
#
# TODO: Replace the stub below with your web server start command.
###############################################################################
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"


# TODO: Start your web server here, for example:
#   exec node server.js
#   exec python -m http.server "$PORT"
#   exec cargo run --release -- --port "$PORT"
echo "http://127.0.0.1:${PORT}"
exec node -r "$REPO_DIR/node_modules/tsx/dist/cjs/index.cjs" "$REPO_DIR/src/server.ts"
