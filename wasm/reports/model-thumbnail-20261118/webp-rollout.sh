#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
drop="$HOME/.config/systemd/user/weborca-models-preview-18974.service.d/98-model-thumbnail-webp.conf"
test ! -e "$drop"
trap 'bash wasm/reports/model-thumbnail-20261118/webp-rollback.sh' ERR
printf '[Service]\nExecStart=\nExecStart=/usr/bin/node %s/wasm/build/model-thumbnail-webp-server-20261118/server.mjs\n' "$PWD" > "$drop"
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
curl -fsS --retry 5 --retry-connrefused --max-time 20 https://server-1.barbel-hops.ts.net:18974/models -o wasm/reports/model-thumbnail-20261118/webp-served.html
cmp wasm/reports/model-thumbnail-20261118/webp-served.html wasm/build/model-thumbnail-candidate-20261118/index.html
curl -fsS --max-time 20 --get --data-urlencode 'url=https://makerworld.bblmw.com/makerworld/model/USf30f60b5564613/design/7895ea5a0ebfee34.png' https://server-1.barbel-hops.ts.net:18974/_model-thumbnail -D wasm/reports/model-thumbnail-20261118/webp.headers -o wasm/reports/model-thumbnail-20261118/cover.webp
identify wasm/reports/model-thumbnail-20261118/cover.webp
systemctl --user is-active weborca-models-preview-18974.service
trap - ERR
