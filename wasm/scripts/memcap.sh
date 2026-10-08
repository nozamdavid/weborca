#!/usr/bin/env bash
# Runs a command in its own cgroup with a memory cap, so one heavy build or
# browser test cannot exhaust host RAM and take down unrelated processes.
# Over the cap, only this command is killed (exit 137). Node processes inside
# also get a JS heap cap, so they fail with a heap error before reaching it.
# Usage: wasm/scripts/memcap.sh <command> [args...]
#   MEMCAP=6G to change the cgroup cap, NODE_HEAP_MB=4096 to change the heap cap.
case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size="*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${NODE_HEAP_MB:-2048}" ;;
esac
exec systemd-run --user --scope --quiet -p MemoryMax="${MEMCAP:-10G}" -p MemorySwapMax=0 "$@"
