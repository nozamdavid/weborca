#!/usr/bin/env bash
set -euo pipefail

# Resolve directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source toolchain environment
# shellcheck source=/dev/null
source "$REPO_ROOT/wasm/scripts/env.sh"

SRC_DIR="$REPO_ROOT/wasm/build/src"
BUILD_DIR="$REPO_ROOT/wasm/build/boost-build"
BOOST_VERSION="1.84.0"
BOOST_DIRNAME="boost-${BOOST_VERSION}"
BOOST_TARBALL="boost-${BOOST_VERSION}.tar.gz"
BOOST_URL="https://github.com/boostorg/boost/releases/download/boost-${BOOST_VERSION}/${BOOST_TARBALL}"
BOOST_SHA256="4d27e9efed0f6f152dc28db6430b9d3dfb40c0345da7342eaa5a987dde57bd95"

mkdir -p "$SRC_DIR"
mkdir -p "$BUILD_DIR"
mkdir -p "$WASM_PREFIX/lib"
mkdir -p "$WASM_PREFIX/include"

# 1. Download Boost tarball if missing or corrupted
TARBALL_PATH="$SRC_DIR/$BOOST_TARBALL"
if [ -f "$TARBALL_PATH" ]; then
    ACTUAL_SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"
    if [ "$ACTUAL_SHA256" != "$BOOST_SHA256" ]; then
        echo "Corrupted tarball detected; re-downloading..."
        rm -f "$TARBALL_PATH"
    fi
fi

if [ ! -f "$TARBALL_PATH" ]; then
    echo "Downloading Boost ${BOOST_VERSION}..."
    curl -L -f -o "$TARBALL_PATH" "$BOOST_URL"
    ACTUAL_SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"
    if [ "$ACTUAL_SHA256" != "$BOOST_SHA256" ]; then
        echo "Error: SHA256 mismatch for $TARBALL_PATH (got $ACTUAL_SHA256, expected $BOOST_SHA256)" >&2
        exit 1
    fi
fi

# 2. Extract Boost source if not already extracted
EXTRACTED_DIR="$SRC_DIR/$BOOST_DIRNAME"
if [ ! -d "$EXTRACTED_DIR" ]; then
    echo "Extracting Boost ${BOOST_VERSION} to $SRC_DIR..."
    tar -xzf "$TARBALL_PATH" -C "$SRC_DIR"
fi

# 3. Apply patch if it applies cleanly
PATCH_FILE="$REPO_ROOT/deps/Boost/0001-Boost-fix.patch"
if [ -f "$PATCH_FILE" ]; then
    if patch --batch -p1 --dry-run -d "$EXTRACTED_DIR" < "$PATCH_FILE" >/dev/null 2>&1; then
        echo "Applying 0001-Boost-fix.patch..."
        patch --batch -p1 -d "$EXTRACTED_DIR" < "$PATCH_FILE"
    else
        echo "Notice: 0001-Boost-fix.patch does not apply cleanly to Boost ${BOOST_VERSION}; skipping patch."
    fi
fi

# 4. Configure zlib support
EXTRA_CMAKE_ARGS=()
if [ -f "$WASM_PREFIX/lib/libz.a" ]; then
    echo "Found zlib at $WASM_PREFIX/lib/libz.a; enabling ZLIB support for Boost.Iostreams"
    EXTRA_CMAKE_ARGS+=(
        "-DBOOST_IOSTREAMS_ENABLE_ZLIB=ON"
        "-DZLIB_ROOT=$WASM_PREFIX"
        "-DZLIB_INCLUDE_DIR=$WASM_PREFIX/include"
        "-DZLIB_LIBRARY=$WASM_PREFIX/lib/libz.a"
    )
else
    echo "Notice: $WASM_PREFIX/lib/libz.a not found; configuring Boost.Iostreams with BOOST_IOSTREAMS_ENABLE_ZLIB=OFF"
    EXTRA_CMAKE_ARGS+=("-DBOOST_IOSTREAMS_ENABLE_ZLIB=OFF")
fi

# 5. Run CMake configuration
# Exclude libraries matching native recipe: contract|fiber|numpy|stacktrace|wave|test
# For Boost.Context, default fcontext uses x86/arm assembly which fails on WebAssembly.
# Setting BOOST_CONTEXT_IMPLEMENTATION=ucontext builds standard POSIX ucontext C++ implementation
# (supported by Emscripten) without assembly, allowing Boost.Context, Boost.Coroutine, and
# dependent Boost.Log (via Boost.Asio) to build cleanly.
echo "Configuring Boost ${BOOST_VERSION} with emcmake cmake..."
emcmake cmake -G Ninja \
    -S "$EXTRACTED_DIR" \
    -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$WASM_PREFIX" \
    -DCMAKE_PREFIX_PATH="$WASM_PREFIX" \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS" \
    -DBOOST_LOCALE_ENABLE_ICU=OFF \
    -DBOOST_IOSTREAMS_ENABLE_BZIP2=OFF \
    -DBOOST_IOSTREAMS_ENABLE_ZSTD=OFF \
    -DBOOST_CONTEXT_IMPLEMENTATION=ucontext \
    -DBOOST_EXCLUDE_LIBRARIES="contract;fiber;numpy;stacktrace;wave;test" \
    "${EXTRA_CMAKE_ARGS[@]}"

# 6. Build
echo "Building Boost with Ninja (${WASM_JOBS:-4} jobs)..."
ninja -C "$BUILD_DIR" -j "${WASM_JOBS:-4}"

# 7. Install to WASM_PREFIX
echo "Installing Boost to $WASM_PREFIX..."
ninja -C "$BUILD_DIR" install

# 8. Boost.System and Boost.Regex are header-only (INTERFACE) targets in Boost 1.84 CMake.
# Provide empty static archives for them if absent so that build systems and checks expecting
# libboost_system.a and libboost_regex.a succeed unconditionally.
TMP_OBJ_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_OBJ_DIR"' EXIT

if [ ! -f "$WASM_PREFIX/lib/libboost_system.a" ]; then
    echo "Creating stub libboost_system.a (Boost.System is header-only in 1.84)..."
    emcc $WASM_CFLAGS -c -x c++ /dev/null -o "$TMP_OBJ_DIR/empty_system.o"
    emar rcs "$WASM_PREFIX/lib/libboost_system.a" "$TMP_OBJ_DIR/empty_system.o"
fi

if [ ! -f "$WASM_PREFIX/lib/libboost_regex.a" ]; then
    echo "Creating stub libboost_regex.a (Boost.Regex is header-only in 1.84 without ICU)..."
    emcc $WASM_CFLAGS -c -x c++ /dev/null -o "$TMP_OBJ_DIR/empty_regex.o"
    emar rcs "$WASM_PREFIX/lib/libboost_regex.a" "$TMP_OBJ_DIR/empty_regex.o"
fi

echo "Boost ${BOOST_VERSION} successfully built and installed into $WASM_PREFIX"
