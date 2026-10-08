#!/usr/bin/env bash

# Resolve script directory and repo root
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    _ENV_SCRIPT="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
    eval '_ENV_SCRIPT=${(%):-%x}'
else
    _ENV_SCRIPT="$0"
fi

_SCRIPT_DIR="$(cd "$(dirname "$_ENV_SCRIPT")" >/dev/null 2>&1 && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd)"

# In zsh, enable word splitting on unquoted variables so flags like $WASM_CFLAGS expand properly
if [ -n "${ZSH_VERSION:-}" ]; then
    setopt shwordsplit
fi

# Source emsdk environment quietly
export EMSDK_QUIET=1
if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
    # shellcheck source=/dev/null
    source "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1
elif [ -n "${EMSDK:-}" ] && [ -f "$EMSDK/emsdk_env.sh" ]; then
    # shellcheck source=/dev/null
    source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
else
    echo "Error: emsdk_env.sh not found in ~/emsdk" >&2
fi

# Ensure the node provided by emsdk takes precedence in PATH
if [ -n "${EMSDK_NODE:-}" ]; then
    export PATH="$(dirname "$EMSDK_NODE"):$PATH"
fi

# Cap the JS heap of every node started from here (tests, vite, tsc, Playwright).
# Wasm memory is outside this heap; wasm/scripts/memcap.sh caps the whole process.
case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size="*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${NODE_HEAP_MB:-2048}" ;;
esac

# Target architecture (default 64)
export WASM_ARCH="${WASM_ARCH:-64}"

export WASM_MEMORY64_FLAG="${WASM_MEMORY64_FLAG:--sMEMORY64=1}"

if [ "$WASM_ARCH" = "64" ]; then
    export WASM_CFLAGS="${WASM_MEMORY64_FLAG} -pthread -fwasm-exceptions -O2"
elif [ "$WASM_ARCH" = "32" ]; then
    export WASM_CFLAGS="-pthread -fwasm-exceptions -O2"
else
    export WASM_CFLAGS="${WASM_MEMORY64_FLAG} -pthread -fwasm-exceptions -O2"
fi

export WASM_PREFIX="${WASM_PREFIX:-${_REPO_ROOT}/wasm/build/prefix-wasm${WASM_ARCH}}"
mkdir -p "$WASM_PREFIX"

export WASM_JOBS="${WASM_JOBS:-10}"

unset _ENV_SCRIPT _SCRIPT_DIR _REPO_ROOT
