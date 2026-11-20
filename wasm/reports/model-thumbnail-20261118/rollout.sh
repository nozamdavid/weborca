#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
unit=weborca-models-preview-18974.service
drop="$HOME/.config/systemd/user/$unit.d/97-model-thumbnail.conf"
test ! -e "$drop"
rollback() { rm -f "$drop"; systemctl --user daemon-reload; systemctl --user restart "$unit"; }
trap rollback ERR
base=wasm/build/model-api-canonical-candidate-20261118
candidate=wasm/build/model-thumbnail-candidate-20261118
(cd "$base"; find . -type f ! -path './assets/*' ! -name index.html -print0 | sort -z | xargs -0 sha256sum) > wasm/reports/model-thumbnail-20261118/runtime.sha256
(cd "$candidate"; sha256sum -c ../../reports/model-thumbnail-20261118/runtime.sha256) > wasm/reports/model-thumbnail-20261118/runtime-check.log
printf '[Service]\nEnvironment=ORCA_ROOT=%s/%s\nExecStart=\nExecStart=/usr/bin/node %s/wasm/build/model-thumbnail-server-20261118/server.mjs\n' "$PWD" "$candidate" "$PWD" > "$drop"
systemctl --user daemon-reload
systemctl --user restart "$unit"
curl -fsS --retry 5 --retry-connrefused --max-time 20 https://server-1.barbel-hops.ts.net:18974/models -o wasm/reports/model-thumbnail-20261118/served.html
cmp wasm/reports/model-thumbnail-20261118/served.html "$candidate/index.html"
curl -fsS --max-time 20 --get --data-urlencode 'url=https://makerworld.bblmw.com/makerworld/model/USf30f60b5564613/design/7895ea5a0ebfee34.png' https://server-1.barbel-hops.ts.net:18974/_model-thumbnail -D wasm/reports/model-thumbnail-20261118/thumbnail.headers -o wasm/reports/model-thumbnail-20261118/thumbnail.png
systemctl --user is-active "$unit"
trap - ERR
