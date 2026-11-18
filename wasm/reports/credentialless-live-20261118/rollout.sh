#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
drop="$HOME/.config/systemd/user/weborca-models-preview-18974.service.d/99-credentialless-live.conf"
test ! -e "$drop"
(cd wasm/build/credentialless-live-candidate-20261118-r2 && sha256sum -c ../../reports/credentialless-20261118/runtime.sha256 >/dev/null)
trap 'bash wasm/reports/credentialless-live-20261118/rollback.sh' ERR
printf '[Service]\nEnvironment=ORCA_COEP=credentialless\nEnvironment=ORCA_ROOT=%s/wasm/build/credentialless-live-candidate-20261118-r2\nExecStart=\nExecStart=/usr/bin/node %s/wasm/build/credentialless-live-server-20261118-r2/server.mjs\n' "$PWD" "$PWD" > "$drop"
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
curl -fsS --retry 5 --retry-connrefused --max-time 20 -A 'Chrome/130.0' https://server-1.barbel-hops.ts.net:18974/models -D wasm/reports/credentialless-live-20261118/chromium.headers -o wasm/reports/credentialless-live-20261118/served.html
cmp wasm/reports/credentialless-live-20261118/served.html wasm/build/credentialless-live-candidate-20261118-r2/index.html
grep -qi '^cross-origin-embedder-policy: credentialless' wasm/reports/credentialless-live-20261118/chromium.headers
systemctl --user is-active weborca-models-preview-18974.service
trap - ERR
