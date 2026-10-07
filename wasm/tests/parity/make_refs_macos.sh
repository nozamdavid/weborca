#!/usr/bin/env bash
set -euo pipefail

# Slices every case in cases.json using native OrcaSlicer CLI under arch -x86_64
# to generate reference G-code files in refs-macos-x86_64/<id>.gcode.
#
# Usage:
#   ./make_refs_macos.sh /path/to/OrcaSlicer.app/Contents/MacOS/OrcaSlicer

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path_to_OrcaSlicer_binary>" >&2
    echo "Example: $0 /Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer" >&2
    exit 1
fi

ORCA_BIN="$1"

if [ ! -f "$ORCA_BIN" ]; then
    echo "Error: OrcaSlicer binary not found at $ORCA_BIN" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CASES_FILE="$SCRIPT_DIR/cases.json"
REFS_DIR="$SCRIPT_DIR/refs-macos-x86_64"
PROFILES_DIR="$REPO_ROOT/resources/profiles"

mkdir -p "$REFS_DIR"

TMP_DIR="$(mktemp -d /tmp/orca_make_refs.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

find_preset_file() {
    local kind="$1"
    local name="$2"
    find "$PROFILES_DIR" -type f -path "*/$kind/$name.json" | head -n 1
}

# Read cases from cases.json using node
CASES_COUNT=$(node -e '
const fs = require("fs");
const cases = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
console.log(cases.length);
' "$CASES_FILE")

echo "Generating macOS x86_64 reference G-codes for $CASES_COUNT cases..."

for ((i = 0; i < CASES_COUNT; i++)); do
    CASE_INFO=$(node -e '
const fs = require("fs");
const cases = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const c = cases[parseInt(process.argv[2], 10)];
console.log([c.id, c.model, c.printer, c.process, c.filaments.join(";")].join("\t"));
' "$CASES_FILE" "$i")

    IFS=$'\t' read -r CASE_ID CASE_MODEL CASE_PRINTER CASE_PROCESS CASE_FILAMENTS <<< "$CASE_INFO"

    echo "[$((i + 1))/$CASES_COUNT] Slicing case: $CASE_ID..."

    MODEL_PATH="$REPO_ROOT/$CASE_MODEL"
    if [ ! -f "$MODEL_PATH" ]; then
        echo "Error: Model file not found: $MODEL_PATH" >&2
        exit 1
    fi

    MACH_FILE="$(find_preset_file "machine" "$CASE_PRINTER")"
    if [ -z "$MACH_FILE" ]; then
        echo "Error: Machine preset not found: $CASE_PRINTER" >&2
        exit 1
    fi

    PROC_FILE="$(find_preset_file "process" "$CASE_PROCESS")"
    if [ -z "$PROC_FILE" ]; then
        echo "Error: Process preset not found: $CASE_PROCESS" >&2
        exit 1
    fi

    FIL_FILES=""
    IFS=';' read -ra FILS_ARR <<< "$CASE_FILAMENTS"
    for f in "${FILS_ARR[@]}"; do
        F_FILE="$(find_preset_file "filament" "$f")"
        if [ -z "$F_FILE" ]; then
            echo "Error: Filament preset not found: $f" >&2
            exit 1
        fi
        if [ -z "$FIL_FILES" ]; then
            FIL_FILES="$F_FILE"
        else
            FIL_FILES="$FIL_FILES;$F_FILE"
        fi
    done

    CASE_TMP_DIR="$TMP_DIR/$CASE_ID"
    mkdir -p "$CASE_TMP_DIR"

    arch -x86_64 "$ORCA_BIN" \
        --load-settings "$MACH_FILE;$PROC_FILE" \
        --load-filaments "$FIL_FILES" \
        --slice 0 \
        --outputdir "$CASE_TMP_DIR" \
        "$MODEL_PATH"

    OUT_GCODE="$CASE_TMP_DIR/plate_1.gcode"
    if [ ! -f "$OUT_GCODE" ]; then
        echo "Error: Expected output $OUT_GCODE not found" >&2
        exit 1
    fi

    DEST_GCODE="$REFS_DIR/$CASE_ID.gcode"
    cp "$OUT_GCODE" "$DEST_GCODE"
    echo "  -> Saved reference to $DEST_GCODE ($(wc -c < "$DEST_GCODE" | tr -d ' ') bytes)"
done

echo "Successfully generated all references in $REFS_DIR"
