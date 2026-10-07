#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"

# Source toolchain environment
source "$REPO_ROOT/wasm/scripts/env.sh"

GMP_VERSION="6.2.1"
GMP_TARBALL="gmp-${GMP_VERSION}.tar.bz2"
GMP_URL="https://github.com/SoftFever/OrcaSlicer_deps/releases/download/gmp-6.2.1/${GMP_TARBALL}"
GMP_FALLBACK_URL="https://ftp.gnu.org/gnu/gmp/${GMP_TARBALL}"

SRC_DIR="$REPO_ROOT/wasm/build/src"
_PREFIX_BASE="$(basename "$WASM_PREFIX")"
BUILD_SUFFIX=""
if [ "$_PREFIX_BASE" != "prefix-wasm${WASM_ARCH:-64}" ]; then
    BUILD_SUFFIX="-${_PREFIX_BASE#prefix-}"
fi
BUILD_DIR="${BUILD_DIR:-$REPO_ROOT/wasm/build/gmp-build${BUILD_SUFFIX}}"

mkdir -p "$SRC_DIR"

if [ ! -f "$SRC_DIR/$GMP_TARBALL" ]; then
    echo "Downloading GMP $GMP_VERSION..."
    curl -L -f -o "$SRC_DIR/$GMP_TARBALL" "$GMP_URL" || \
    curl -L -f -o "$SRC_DIR/$GMP_TARBALL" "$GMP_FALLBACK_URL"
fi

if [ ! -d "$SRC_DIR/gmp-$GMP_VERSION" ]; then
    echo "Extracting GMP $GMP_VERSION..."
    tar -xjf "$SRC_DIR/$GMP_TARBALL" -C "$SRC_DIR"
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Ensure host tools are built with the host C compiler rather than emsdk's clang (which defaults to target 'unknown')
export CC_FOR_BUILD="${CC_FOR_BUILD:-$(command -v /usr/bin/cc || command -v cc)}"

HOST_TRIPLE="$("$SRC_DIR/gmp-$GMP_VERSION/config.guess")"

if [ ! -f Makefile ]; then
    CFLAGS="$WASM_CFLAGS" CXXFLAGS="$WASM_CFLAGS" \
    emconfigure "$SRC_DIR/gmp-$GMP_VERSION/configure" \
        --prefix="$WASM_PREFIX" \
        --build="$HOST_TRIPLE" \
        --host=none \
        --disable-assembly \
        --enable-static \
        --disable-shared \
        --enable-cxx
fi

emmake make -j"$WASM_JOBS"
emmake make install
