#!/usr/bin/env bash
# Reuse a configured headless Ninja build without compiling the GUI CLI entry point.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
build=$(realpath "${1:?usage: build-native-driver.sh configured-native-build}")
cmake --build "$build" --target libslic3r libnest2d -j "${JOBS:-4}"
commands=$(mktemp)
trap 'rm -f "$commands"' EXIT
ninja -C "$build" -t commands OrcaSlicer > "$commands"
# Compile the existing Print pipeline driver with the library's exact definitions/includes.
compile=$(sed -n '\| -c .*/src/libslic3r/Print.cpp$|p' "$commands" | head -1)
test -n "$compile"
compile=${compile%% -MD *}
cd "$build"
eval "$compile -o native-parity-driver.o -c \"$root/wasm/tests/parity/native-cube.cpp\""
eval "$compile -I\"$root/deps_src\" -o native-parity-nanosvg.o -c \"$root/wasm/engine/NanoSVGImpl.cpp\""
# Retain CMake's transitive native libraries; omit CLI packaging/post-build commands.
link=$(tail -1 "$commands")
link=${link%% && cd *}
link=${link//src\/CMakeFiles\/OrcaSlicer.dir\/OrcaSlicer.cpp.o/native-parity-driver.o}
link=${link//-o src\/orca-slicer/-o native-parity-driver}
link=${link/native-parity-driver.o/native-parity-driver.o native-parity-nanosvg.o}
eval "$link"
