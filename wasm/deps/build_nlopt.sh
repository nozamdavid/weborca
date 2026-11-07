#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="nlopt"
VERSION="2.5.0"
ARCHIVE_URL="https://github.com/stevengj/nlopt/archive/v2.5.0.tar.gz"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}.tar.gz"
SRC_DIR="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}"
_PREFIX_BASE="$(basename "$WASM_PREFIX")"
BUILD_SUFFIX=""
if [ "$_PREFIX_BASE" != "prefix-wasm${WASM_ARCH:-64}" ]; then
    BUILD_SUFFIX="-${_PREFIX_BASE#prefix-}"
fi
BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/wasm/build/${DEP_NAME}-build${BUILD_SUFFIX}}"

mkdir -p "$REPO_ROOT/wasm/build/src"

if [ ! -f "$SRC_ARCHIVE" ]; then
    echo "Downloading $DEP_NAME $VERSION..."
    curl -fsSL "$ARCHIVE_URL" -o "$SRC_ARCHIVE"
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "Extracting $DEP_NAME $VERSION..."
    tar -xzf "$SRC_ARCHIVE" -C "$REPO_ROOT/wasm/build/src"
fi

# Keep only the algorithms libnest2d uses (Nelder-Mead, Subplex, ESCH); the rest would be
# linked into the engine through the nlopt_optimize() switch. Idempotent.
PRUNE_PATCH="$SCRIPT_DIR/nlopt-prune-algorithms.patch"
if patch -p1 -N --dry-run -s -d "$SRC_DIR" < "$PRUNE_PATCH" > /dev/null 2>&1; then
    echo "Pruning unused $DEP_NAME algorithms..."
    patch -p1 -N -s -d "$SRC_DIR" < "$PRUNE_PATCH"
fi

mkdir -p "$BUILD_DIR"

echo "Configuring $DEP_NAME..."
emcmake cmake -G Ninja \
    -S "$SRC_DIR" \
    -B "$BUILD_DIR" \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_PREFIX_PATH="$WASM_PREFIX" \
    -DCMAKE_INSTALL_PREFIX="$WASM_PREFIX" \
    -DBUILD_SHARED_LIBS=OFF \
    -DNLOPT_PYTHON=OFF \
    -DNLOPT_OCTAVE=OFF \
    -DNLOPT_MATLAB=OFF \
    -DNLOPT_GUILE=OFF \
    -DNLOPT_SWIG=OFF \
    -DNLOPT_TESTS=OFF

echo "Building and installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
