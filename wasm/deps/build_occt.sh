#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source environment
source "$REPO_ROOT/wasm/scripts/env.sh"

DEP_NAME="occt"
VERSION="8.0.1"
TAG="V8_0_1"
EXPECTED_SHA256="7c033d917ee8f040c0512d289dcc5f02c148889d5bac17c3e25639accb44f0da"
ARCHIVE_URL="https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/${TAG}.zip"
SRC_ARCHIVE="$REPO_ROOT/wasm/build/src/${DEP_NAME}-${VERSION}.zip"
# Upstream GitHub release zip extracts to OCCT-8_0_1
SRC_DIR="$REPO_ROOT/wasm/build/src/OCCT-${TAG#V}"
_PREFIX_BASE="$(basename "$WASM_PREFIX")"
BUILD_SUFFIX=""
if [ "$_PREFIX_BASE" != "prefix-wasm${WASM_ARCH:-64}" ]; then
    BUILD_SUFFIX="-${_PREFIX_BASE#prefix-}"
fi
BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/wasm/build/${DEP_NAME}-build${BUILD_SUFFIX}}"

mkdir -p "$REPO_ROOT/wasm/build/src"

if [ ! -f "$SRC_ARCHIVE" ]; then
    echo "Downloading $DEP_NAME $VERSION ($TAG)..."
    curl -fsSL "$ARCHIVE_URL" -o "$SRC_ARCHIVE"
fi

echo "Verifying $DEP_NAME archive checksum..."
ACTUAL_SHA256="$(sha256sum "$SRC_ARCHIVE" | awk '{print $1}')"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
    echo "Error: SHA256 checksum mismatch for $SRC_ARCHIVE" >&2
    echo "Expected: $EXPECTED_SHA256" >&2
    echo "Actual:   $ACTUAL_SHA256" >&2
    exit 1
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "Extracting $DEP_NAME $VERSION..."
    unzip -q -o "$SRC_ARCHIVE" -d "$REPO_ROOT/wasm/build/src"
fi

if [ ! -d "$SRC_DIR" ]; then
    echo "Error: Extracted directory not found: $SRC_DIR" >&2
    exit 1
fi

mkdir -p "$BUILD_DIR"

# Explicitly limit parallel jobs to at most 6 to preserve memory budget
JOBS="${WASM_JOBS:-6}"
if [ "$JOBS" -gt 6 ]; then
    JOBS=6
fi

echo "Configuring $DEP_NAME (minimal headless WASM64 build for STEP tessellation)..."
emcmake cmake -G Ninja \
    -S "$SRC_DIR" \
    -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_STANDARD=17 \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS" \
    -DCMAKE_PREFIX_PATH="$WASM_PREFIX" \
    -DCMAKE_INSTALL_PREFIX="$WASM_PREFIX" \
    -DBUILD_LIBRARY_TYPE=Static \
    -DINSTALL_DIR_LAYOUT=Unix \
    -DINSTALL_DIR_BIN=bin/occt \
    -DINSTALL_DIR_LIB=lib/occt \
    -DINSTALL_DIR_INCLUDE=include/occt \
    -DINSTALL_DIR_CMAKE=lib/cmake/occt \
    -DBUILD_DOC_Overview=OFF \
    -DUSE_TK=OFF \
    -DUSE_TBB=OFF \
    -DUSE_FREETYPE=OFF \
    -DUSE_FFMPEG=OFF \
    -DUSE_OPENGL=OFF \
    -DUSE_VTK=OFF \
    -DBUILD_MODULE_Draw=OFF \
    -DBUILD_MODULE_Visualization=OFF \
    -DBUILD_MODULE_ApplicationFramework=OFF \
    -DBUILD_MODULE_FoundationClasses=OFF \
    -DBUILD_MODULE_ModelingAlgorithms=OFF \
    -DBUILD_MODULE_ModelingData=OFF \
    -DBUILD_MODULE_DataExchange=ON \
    -DBUILD_ADDITIONAL_TOOLKITS="TKMesh"

echo "Building and installing $DEP_NAME toolkits (jobs: $JOBS)..."
cmake --build "$BUILD_DIR" --target install -j "$JOBS"

# Expose libraries in both $WASM_PREFIX/lib/occt and $WASM_PREFIX/lib
mkdir -p "$WASM_PREFIX/lib"
for f in "$WASM_PREFIX/lib/occt"/*.a; do
    [ -e "$f" ] || continue
    ln -sfn "$f" "$WASM_PREFIX/lib/$(basename "$f")"
done

echo "$DEP_NAME installed successfully to $WASM_PREFIX"
