#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="jpeg"
VERSION="3.0.1"
ARCHIVE_URL="https://github.com/libjpeg-turbo/libjpeg-turbo/archive/refs/tags/3.0.1.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/libjpeg-turbo-${VERSION}.zip"
SRC_DIR="$REPO_ROOT/wasm/build/src/libjpeg-turbo-${VERSION}"
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
    unzip -q -o "$SRC_ARCHIVE" -d "$REPO_ROOT/wasm/build/src"
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
    -DENABLE_SHARED=OFF \
    -DENABLE_STATIC=ON \
    -DWITH_SIMD=OFF

echo "Building and installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
