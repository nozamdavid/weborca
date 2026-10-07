#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="expat"
SRC_DIR="$REPO_ROOT/wasm/build/src/${DEP_NAME}"
BUILD_DIR="$REPO_ROOT/wasm/build/${DEP_NAME}-build"

mkdir -p "$REPO_ROOT/wasm/build/src"

if [ ! -d "$SRC_DIR" ]; then
    echo "Copying $DEP_NAME from deps/EXPAT/expat..."
    cp -R "$REPO_ROOT/deps/EXPAT/expat" "$SRC_DIR"
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
    -DXML_DEV_URANDOM=ON \
    -DBUILD_SHARED_LIBS=OFF

echo "Building and installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
