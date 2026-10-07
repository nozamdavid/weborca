#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="eigen"
VERSION="5.0.1"
ARCHIVE_URL="https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}.zip"
SRC_DIR="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}"
BUILD_DIR="$REPO_ROOT/wasm/build/${DEP_NAME}-build"

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
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_PREFIX_PATH="$WASM_PREFIX" \
    -DCMAKE_INSTALL_PREFIX="$WASM_PREFIX" \
    -DEIGEN_BUILD_TESTING=OFF \
    -DEIGEN_BUILD_BLAS=OFF \
    -DEIGEN_BUILD_LAPACK=OFF

echo "Installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
