#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/wasm/scripts/env.sh"

cd "$REPO_ROOT"

if [ -z "${ORCA_WASM_BUILD_DIR:-}" ]; then
    _PREFIX_BASE="$(basename "$WASM_PREFIX")"
    if [ "$_PREFIX_BASE" != "prefix-wasm${WASM_ARCH:-64}" ]; then
        ORCA_WASM_BUILD_DIR="wasm/build/orca-${_PREFIX_BASE#prefix-}"
    else
        ORCA_WASM_BUILD_DIR="wasm/build/orca-wasm64"
    fi
fi

emcmake cmake -S . -B "$ORCA_WASM_BUILD_DIR" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DSLIC3R_GUI=OFF \
    -DSLIC3R_CAD=OFF \
    -DSLIC3R_PCH=OFF \
    -DSLIC3R_STATIC=ON \
    -DSLIC3R_WITH_OCCT=OFF \
    -DSLIC3R_WITH_OPENCV=OFF \
    -DSLIC3R_WITH_ASSIMP=OFF \
    -DSLIC3R_WITH_DRACO=OFF \
    -DSLIC3R_WITH_OPENSSL=OFF \
    -DSLIC3R_WITH_FREETYPE=OFF \
    -DORCA_WASM_SIZE_TIERS=ON \
    -DORCA_WASM_NOLOG=ON \
    -DCMAKE_PREFIX_PATH="$WASM_PREFIX" \
    -DCMAKE_FIND_ROOT_PATH="$WASM_PREFIX" \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS"

cmake --build "$ORCA_WASM_BUILD_DIR" --target orca_slice_driver --target orca_engine -j "$WASM_JOBS"
