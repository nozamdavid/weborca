#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="zlib"
VERSION="1.2.13"
ARCHIVE_URL="https://github.com/madler/zlib/archive/refs/tags/v1.2.13.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}.zip"
SRC_DIR="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}"
BUILD_DIR="$REPO_ROOT/wasm/build/${DEP_NAME}-build"
PATCH_FILE="$REPO_ROOT/deps/ZLIB/0001-Respect-BUILD_SHARED_LIBS.patch"

mkdir -p "$REPO_ROOT/wasm/build/src"

if [ ! -f "$SRC_ARCHIVE" ]; then
    echo "Downloading $DEP_NAME $VERSION..."
    curl -fsSL "$ARCHIVE_URL" -o "$SRC_ARCHIVE"
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "Extracting $DEP_NAME $VERSION..."
    unzip -q -o "$SRC_ARCHIVE" -d "$REPO_ROOT/wasm/build/src"
fi

if [ -f "$PATCH_FILE" ] && [ ! -f "$SRC_DIR/.patched" ]; then
    echo "Applying patch $PATCH_FILE..."
    patch -p1 -N -d "$SRC_DIR" < "$PATCH_FILE" || true
    touch "$SRC_DIR/.patched"
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
    -DSKIP_INSTALL_FILES=ON \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON

echo "Building and installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
