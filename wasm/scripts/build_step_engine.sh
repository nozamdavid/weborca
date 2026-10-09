#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/wasm/scripts/env.sh"

cd "$REPO_ROOT"

# Ensure memory cap and job limits
JOBS="${WASM_JOBS:-4}"
if [ "$JOBS" -gt 6 ]; then
    JOBS=6
fi

ORCA_STEP_BUILD_DIR="${ORCA_STEP_BUILD_DIR:-$REPO_ROOT/wasm/build/orca-step-runtime}"
OCCT_PREFIX="${OCCT_PREFIX:-$REPO_ROOT/wasm/build/prefix-occt-step}"
BASE_PREFIX="${BASE_PREFIX:-$REPO_ROOT/wasm/build/prefix-wasm${WASM_ARCH:-64}}"
COMBINED_PREFIX="${COMBINED_PREFIX:-$REPO_ROOT/wasm/build/prefix-step-combined}"

if [ ! -d "$OCCT_PREFIX" ]; then
    echo "Error: OCCT prefix directory not found at $OCCT_PREFIX" >&2
    exit 1
fi

if [ ! -d "$BASE_PREFIX" ]; then
    echo "Error: Base wasm prefix directory not found at $BASE_PREFIX" >&2
    exit 1
fi

if [ -z "${COMBINED_PREFIX:-}" ]; then
    echo "Error: COMBINED_PREFIX must not be empty" >&2
    exit 1
fi

COMBINED_CANON="$(realpath -m "$COMBINED_PREFIX")"
BASE_CANON="$(realpath -m "$BASE_PREFIX")"
OCCT_CANON="$(realpath -m "$OCCT_PREFIX")"
REPO_CANON="$(realpath -m "$REPO_ROOT")"
BUILD_CANON="$(realpath -m "$ORCA_STEP_BUILD_DIR")"

if [ "$COMBINED_CANON" = "/" ]; then
    echo "Error: COMBINED_PREFIX cannot be root filesystem" >&2
    exit 1
fi

if [ "$REPO_CANON" = "$COMBINED_CANON" ] || [[ "$REPO_CANON" == "$COMBINED_CANON"/* ]]; then
    echo "Error: COMBINED_PREFIX cannot be REPO_ROOT or an ancestor of REPO_ROOT: $COMBINED_PREFIX" >&2
    exit 1
fi

if [ "$BASE_CANON" = "$COMBINED_CANON" ] || [[ "$BASE_CANON" == "$COMBINED_CANON"/* ]] || [[ "$COMBINED_CANON" == "$BASE_CANON"/* ]]; then
    echo "Error: COMBINED_PREFIX overlaps with BASE_PREFIX: $COMBINED_PREFIX" >&2
    exit 1
fi

if [ "$OCCT_CANON" = "$COMBINED_CANON" ] || [[ "$OCCT_CANON" == "$COMBINED_CANON"/* ]] || [[ "$COMBINED_CANON" == "$OCCT_CANON"/* ]]; then
    echo "Error: COMBINED_PREFIX overlaps with OCCT_PREFIX: $COMBINED_PREFIX" >&2
    exit 1
fi

if [ "$BUILD_CANON" = "$COMBINED_CANON" ] || [[ "$BUILD_CANON" == "$COMBINED_CANON"/* ]] || [[ "$COMBINED_CANON" == "$BUILD_CANON"/* ]]; then
    echo "Error: COMBINED_PREFIX overlaps with ORCA_STEP_BUILD_DIR: $COMBINED_PREFIX" >&2
    exit 1
fi

link_merge() {
    local src="$1"
    local dst="$2"
    mkdir -p "$dst"
    for item in "$src"/*; do
        [ -e "$item" ] || continue
        local name
        name="$(basename "$item")"
        if [ -d "$item" ]; then
            if [ -L "$dst/$name" ]; then
                # Existing entry is a symlink to another directory; convert to real directory and link its children
                local prev_target
                prev_target="$(readlink -f "$dst/$name")"
                rm -f "$dst/$name"
                mkdir -p "$dst/$name"
                for sub in "$prev_target"/*; do
                    [ -e "$sub" ] || continue
                    ln -sfn "$sub" "$dst/$name/$(basename "$sub")"
                done
            fi
            if [ -d "$dst/$name" ]; then
                link_merge "$item" "$dst/$name"
            else
                ln -sfn "$item" "$dst/$name"
            fi
        else
            ln -sfn "$item" "$dst/$name"
        fi
    done
}

echo "Setting up combined dependency prefix at $COMBINED_PREFIX..."
rm -rf "$COMBINED_PREFIX"
mkdir -p "$COMBINED_PREFIX/bin" "$COMBINED_PREFIX/include" "$COMBINED_PREFIX/lib/cmake" "$COMBINED_PREFIX/share"

# Symlink bin
if [ -d "$BASE_PREFIX/bin" ]; then
    link_merge "$BASE_PREFIX/bin" "$COMBINED_PREFIX/bin"
fi
if [ -d "$OCCT_PREFIX/bin" ]; then
    link_merge "$OCCT_PREFIX/bin" "$COMBINED_PREFIX/bin"
fi

# Symlink headers
link_merge "$BASE_PREFIX/include" "$COMBINED_PREFIX/include"
link_merge "$OCCT_PREFIX/include" "$COMBINED_PREFIX/include"

# Symlink libraries
for item in "$BASE_PREFIX/lib"/*; do
    [ -e "$item" ] || continue
    [ "$(basename "$item")" = "cmake" ] && continue
    ln -sfn "$item" "$COMBINED_PREFIX/lib/$(basename "$item")"
done
for item in "$OCCT_PREFIX/lib"/*; do
    [ -e "$item" ] || continue
    [ "$(basename "$item")" = "cmake" ] && continue
    ln -sfn "$item" "$COMBINED_PREFIX/lib/$(basename "$item")"
done

# Symlink cmake package configurations
link_merge "$BASE_PREFIX/lib/cmake" "$COMBINED_PREFIX/lib/cmake"
link_merge "$OCCT_PREFIX/lib/cmake" "$COMBINED_PREFIX/lib/cmake"

# Symlink share directories
link_merge "$BASE_PREFIX/share" "$COMBINED_PREFIX/share"
if [ -d "$OCCT_PREFIX/share" ]; then
    link_merge "$OCCT_PREFIX/share" "$COMBINED_PREFIX/share"
fi

echo "Configuring isolated STEP-enabled engine in $ORCA_STEP_BUILD_DIR..."
emcmake cmake -S . -B "$ORCA_STEP_BUILD_DIR" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DSLIC3R_GUI=OFF \
    -DSLIC3R_CAD=OFF \
    -DSLIC3R_PCH=OFF \
    -DSLIC3R_STATIC=ON \
    -DSLIC3R_WITH_OCCT=ON \
    -DSLIC3R_WITH_OPENCV=OFF \
    -DSLIC3R_WITH_ASSIMP=OFF \
    -DSLIC3R_WITH_DRACO=OFF \
    -DSLIC3R_WITH_OPENSSL=OFF \
    -DSLIC3R_WITH_FREETYPE=OFF \
    -DCMAKE_PREFIX_PATH="$COMBINED_PREFIX" \
    -DCMAKE_FIND_ROOT_PATH="$COMBINED_PREFIX" \
    -DCMAKE_C_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS" \
    -DCMAKE_CXX_FLAGS="$WASM_CFLAGS -UOCC_CONVERT_SIGNALS"

echo "Building orca_engine target (jobs: $JOBS)..."
cmake --build "$ORCA_STEP_BUILD_DIR" --target orca_engine -j "$JOBS"
