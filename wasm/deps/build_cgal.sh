#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="cgal"
VERSION="5.6.3"
ARCHIVE_URL="https://github.com/CGAL/cgal/releases/download/v5.6.3/CGAL-5.6.3.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/CGAL-${VERSION}.zip"
SRC_DIR="$REPO_ROOT/wasm/build/src/CGAL-${VERSION}"
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
    -DBUILD_TESTING=OFF \
    -DCGAL_ENABLE_EXAMPLES=OFF

echo "Installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
