#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT=5056
SERVE_BIN="$REPO_ROOT/wasm/build/web-smoke/node_modules/.bin/serve"
CONFIG_FILE="$REPO_ROOT/wasm/web-smoke/serve.json"

if [ ! -x "$SERVE_BIN" ]; then
    echo "Error: static server binary not found at $SERVE_BIN" >&2
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: serve config not found at $CONFIG_FILE" >&2
    exit 1
fi

echo "=========================================================="
echo "OrcaSlicer WebAssembly Static Server"
echo "Demo URL: http://localhost:$PORT/wasm/web/demo/index.html"
echo "COOP/COEP headers active via wasm/web-smoke/serve.json"
echo "=========================================================="

cd "$REPO_ROOT"
exec "$SERVE_BIN" -c "$CONFIG_FILE" -l "$PORT" .
