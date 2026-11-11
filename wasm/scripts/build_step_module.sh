#!/usr/bin/env bash
# Builds the standalone STEP tessellation module:
#   wasm/build/step-module/step_tessellate.{mjs,wasm}
# This is deliberately separate from build_step_engine.sh: the engine under
# wasm/build/orca-step-runtime and the shipped ui-* dists are not touched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/wasm/scripts/env.sh"

cd "$REPO_ROOT"
export ORCA_BUILD_SOURCE="$(node wasm/scripts/runtime-manifest.mjs fingerprint)"

JOBS="${WASM_JOBS:-4}"
if [ "$JOBS" -gt 6 ]; then
    JOBS=6
fi

BASE_PREFIX="${BASE_PREFIX:-$REPO_ROOT/wasm/build/prefix-wasm${WASM_ARCH:-64}}"
export OCCT_PREFIX="${OCCT_PREFIX:-$REPO_ROOT/wasm/build/prefix-occt-step}"
WASM_PREFIX="$BASE_PREFIX" node wasm/scripts/runtime-manifest.mjs identity step
STEP_MODULE_BUILD_DIR="${STEP_MODULE_BUILD_DIR:-$REPO_ROOT/wasm/build/step-module-build}"
STEP_MODULE_OUT_DIR="${STEP_MODULE_OUT_DIR:-$REPO_ROOT/wasm/build/step-module}"

if [ ! -d "$BASE_PREFIX" ]; then
    echo "Error: Base wasm prefix directory not found at $BASE_PREFIX" >&2
    exit 1
fi

if [ ! -d "$OCCT_PREFIX" ]; then
    echo "Error: OCCT prefix directory not found at $OCCT_PREFIX" >&2
    exit 1
fi

echo "Configuring STEP tessellation module in $STEP_MODULE_BUILD_DIR..."
emcmake cmake -S "$REPO_ROOT/wasm/step" -B "$STEP_MODULE_BUILD_DIR" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBASE_PREFIX="$BASE_PREFIX" \
    -DOCCT_PREFIX="$OCCT_PREFIX" \
    -DSTEP_MODULE_OUT_DIR="$STEP_MODULE_OUT_DIR" \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS"

echo "Building step_tessellate target (jobs: $JOBS)..."
cmake --build "$STEP_MODULE_BUILD_DIR" --target step_tessellate -j "$JOBS"

# OCCT's LGPL exception notice must ship next to the module that embeds it.
OCCT_SRC_DIR="${OCCT_SRC_ROOT:-$REPO_ROOT/wasm/build/src/occt-8.0.1-seam-pcurve}/OCCT-8_0_1"
if [ -d "$OCCT_SRC_DIR" ] && [ -d "$STEP_MODULE_OUT_DIR" ]; then
    cp "$OCCT_SRC_DIR/LICENSE_LGPL_21.txt" "$OCCT_SRC_DIR/OCCT_LGPL_EXCEPTION.txt" "$STEP_MODULE_OUT_DIR/"
fi

echo "STEP tessellation module written to $STEP_MODULE_OUT_DIR"
WASM_PREFIX="$BASE_PREFIX" OCCT_PREFIX="$OCCT_PREFIX" node wasm/scripts/runtime-manifest.mjs create step "$STEP_MODULE_OUT_DIR"
