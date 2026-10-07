#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"

# Source toolchain environment
source "$REPO_ROOT/wasm/scripts/env.sh"

MPFR_VERSION="4.2.2"
MPFR_TARBALL="mpfr-${MPFR_VERSION}.tar.bz2"
MPFR_URL="https://ftp.gnu.org/gnu/mpfr/${MPFR_TARBALL}"
MPFR_FALLBACK_URL="https://www.mpfr.org/mpfr-${MPFR_VERSION}/${MPFR_TARBALL}"

SRC_DIR="$REPO_ROOT/wasm/build/src"
BUILD_DIR="$REPO_ROOT/wasm/build/mpfr-build"

mkdir -p "$SRC_DIR"

if [ ! -f "$SRC_DIR/$MPFR_TARBALL" ]; then
    echo "Downloading MPFR $MPFR_VERSION..."
    curl -L -f -o "$SRC_DIR/$MPFR_TARBALL" "$MPFR_URL" || \
    curl -L -f -o "$SRC_DIR/$MPFR_TARBALL" "$MPFR_FALLBACK_URL"
fi

if [ ! -d "$SRC_DIR/mpfr-$MPFR_VERSION" ]; then
    echo "Extracting MPFR $MPFR_VERSION..."
    tar -xjf "$SRC_DIR/$MPFR_TARBALL" -C "$SRC_DIR"
fi

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -f Makefile ]; then
    CFLAGS="$WASM_CFLAGS" \
    emconfigure "$SRC_DIR/mpfr-$MPFR_VERSION/configure" \
        --prefix="$WASM_PREFIX" \
        --with-gmp="$WASM_PREFIX" \
        --enable-static \
        --disable-shared
fi

emmake make -j"$WASM_JOBS"
emmake make install
