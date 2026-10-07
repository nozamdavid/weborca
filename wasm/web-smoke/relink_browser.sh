#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/wasm/scripts/env.sh"

cd "$REPO_ROOT/wasm/build/orca-wasm64"

OUT_DIR="$REPO_ROOT/wasm/build/web-smoke"
mkdir -p "$OUT_DIR"

/home/david/emsdk/upstream/emscripten/em++ \
    -sMEMORY64=1 \
    -pthread \
    -fwasm-exceptions \
    -O2 -Wall -O3 -DNDEBUG \
    -sALLOW_MEMORY_GROWTH=1 \
    -sMAXIMUM_MEMORY=8GB \
    -sMALLOC=mimalloc \
    -sPROXY_TO_PTHREAD \
    -sEXIT_RUNTIME=0 \
    -sPTHREAD_POOL_SIZE=8 \
    -sSTACK_SIZE=8MB \
    -sDEFAULT_PTHREAD_STACK_SIZE=8MB \
    -sENVIRONMENT=web,worker \
    -sMODULARIZE=1 \
    -sEXPORT_NAME=createOrca \
    -sEXPORTED_RUNTIME_METHODS=FS,callMain \
    -sINVOKE_RUN=0 \
    wasm/spike/CMakeFiles/orca_slice_driver.dir/slice_driver.cpp.o \
    -o "$OUT_DIR/orca_slice_driver.js" \
    src/libslic3r/liblibslic3r.a \
    deps_src/libnest2d/liblibnest2d.a \
    src/libslic3r/liblibslic3r.a \
    deps_src/libnest2d/liblibnest2d.a \
    deps_src/miniz/libminiz_static.a \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libexpat.a" \
    deps_src/clipper2/libClipper2.a \
    -lm \
    deps_src/glu-libtess/libglu-libtess.a \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libjpeg.a" \
    src/libslic3r/liblibslic3r_cgal.a \
    deps_src/admesh/libadmesh.a \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_log_setup.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_log.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_filesystem.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_coroutine.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_context.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_serialization.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_locale.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_thread.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_chrono.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_atomic.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_date_time.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_exception.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_iostreams.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_random.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_program_options.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_container.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libboost_nowide.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libgmpxx.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libmpfr.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libgmp.a" \
    deps_src/mcut/libmcut.a \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/liblibnoise_static.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libpng.a" \
    deps_src/qhull/libqhullstatic.a \
    deps_src/qoi/libqoi.a \
    lib/libsemver.a \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libtbbmalloc.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libz.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libtbb.a" \
    "$REPO_ROOT/wasm/build/prefix-wasm64/lib/libnlopt.a" \
    -lm
