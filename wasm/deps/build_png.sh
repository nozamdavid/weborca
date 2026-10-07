#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="png"
VERSION="1.6.35"
ARCHIVE_URL="https://github.com/glennrp/libpng/archive/refs/tags/v1.6.35.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/libpng-${VERSION}.zip"
SRC_DIR="$REPO_ROOT/wasm/build/src/libpng-${VERSION}"
_PREFIX_BASE="$(basename "$WASM_PREFIX")"
BUILD_SUFFIX=""
if [ "$_PREFIX_BASE" != "prefix-wasm${WASM_ARCH:-64}" ]; then
    BUILD_SUFFIX="-${_PREFIX_BASE#prefix-}"
fi
BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/wasm/build/${DEP_NAME}-build${BUILD_SUFFIX}}"
PATCH_PNG="$REPO_ROOT/deps/PNG/PNG.patch"
PATCH_CLANG19="$REPO_ROOT/deps/PNG/0002-clang19-macos.patch"

mkdir -p "$REPO_ROOT/wasm/build/src"

if [ ! -f "$SRC_ARCHIVE" ]; then
    echo "Downloading $DEP_NAME $VERSION..."
    curl -fsSL "$ARCHIVE_URL" -o "$SRC_ARCHIVE"
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "Extracting $DEP_NAME $VERSION..."
    unzip -q -o "$SRC_ARCHIVE" -d "$REPO_ROOT/wasm/build/src"
fi

if [ ! -f "$SRC_DIR/.patched" ]; then
    echo "Applying patches for $DEP_NAME..."
    patch -p1 -N -d "$SRC_DIR" < "$PATCH_PNG" || true
    patch -p1 -N -d "$SRC_DIR" < "$PATCH_CLANG19" || true
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
    -DPNG_SHARED=OFF \
    -DPNG_STATIC=ON \
    -DPNG_PREFIX=prusaslicer_ \
    -DPNG_TESTS=OFF \
    -DDISABLE_DEPENDENCY_TRACKING=OFF \
    -DPNG_ARM_NEON=off \
    -DPNG_HARDWARE_OPTIMIZATIONS=off \
    -DZLIB_ROOT="$WASM_PREFIX" \
    -DZLIB_LIBRARY="$WASM_PREFIX/lib/libz.a" \
    -DZLIB_INCLUDE_DIR="$WASM_PREFIX/include" \
    -DM_LIBRARY=""

echo "Building and installing $DEP_NAME..."
cmake --build "$BUILD_DIR" --target install

echo "$DEP_NAME installed to $WASM_PREFIX"
