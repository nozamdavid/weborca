#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DEST_DIR="$REPO_ROOT/wasm/build/models"
DEST_FILE="$DEST_DIR/3DBenchy.stl"
PINNED_SHA256="6ab57f1c3f8e86bc3cbd302c6fa6270acf06277c6335454e922419c25d42e97e"
URL="https://raw.githubusercontent.com/CreativeTools/3DBenchy/master/Single-part/3DBenchy.stl"

mkdir -p "$DEST_DIR"

compute_sha256() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
    else
        node -e '
            const fs = require("fs");
            const crypto = require("crypto");
            const h = crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex");
            console.log(h);
        ' "$file"
    fi
}

if [ -f "$DEST_FILE" ]; then
    CURRENT_HASH="$(compute_sha256 "$DEST_FILE")"
    if [ "$CURRENT_HASH" = "$PINNED_SHA256" ]; then
        echo "Model 3DBenchy.stl already exists with valid hash ($PINNED_SHA256). Skipping download."
        exit 0
    else
        echo "Existing 3DBenchy.stl hash mismatch ($CURRENT_HASH != $PINNED_SHA256). Re-downloading..."
    fi
fi

echo "Downloading 3DBenchy.stl from $URL..."
TMP_FILE="$(mktemp "$DEST_DIR/3DBenchy.tmp.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT

curl -fsSL "$URL" -o "$TMP_FILE"

DOWNLOADED_HASH="$(compute_sha256 "$TMP_FILE")"
if [ "$DOWNLOADED_HASH" != "$PINNED_SHA256" ]; then
    echo "Error: Downloaded file hash ($DOWNLOADED_HASH) does not match expected hash ($PINNED_SHA256)!" >&2
    exit 1
fi

mv "$TMP_FILE" "$DEST_FILE"
echo "Successfully downloaded and verified 3DBenchy.stl ($DEST_FILE)."
