#!/usr/bin/env bash
set -euo pipefail
unit=weborca-models-preview-18974.service
drop="$HOME/.config/systemd/user/$unit.d/95-model-api.conf"
test ! -e "$drop"
rollback() { rm -f "$drop"; systemctl --user daemon-reload; systemctl --user restart "$unit"; }
trap rollback ERR
printf '[Service]\nEnvironment=ORCA_ROOT=%s/wasm/build/model-api-candidate-20261118\n' "$PWD" > "$drop"
systemctl --user daemon-reload
systemctl --user restart "$unit"
curl -sS --retry 5 --retry-connrefused --max-time 20 https://server-1.barbel-hops.ts.net:18974/models -o wasm/reports/model-api-20261118/served.html
cmp wasm/reports/model-api-20261118/served.html wasm/build/model-api-candidate-20261118/index.html
systemctl --user is-active "$unit"
trap - ERR
