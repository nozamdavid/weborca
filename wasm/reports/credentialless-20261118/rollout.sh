#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
drop="$HOME/.config/systemd/user/weborca-models-preview-18974.service.d/99-credentialless.conf"
test ! -e "$drop"
(cd wasm/build/credentialless-candidate-20261118 && sha256sum -c ../../reports/credentialless-20261118/runtime.sha256 >/dev/null)
trap 'bash wasm/reports/credentialless-20261118/rollback.sh' ERR
printf '[Service]\nEnvironment=ORCA_COEP=credentialless\nEnvironment=ORCA_ROOT=%s/wasm/build/credentialless-candidate-20261118\nExecStart=\nExecStart=/usr/bin/node %s/wasm/build/credentialless-server-20261118/server.mjs\n' "$PWD" "$PWD" > "$drop"
systemctl --user daemon-reload
systemctl --user restart weborca-models-preview-18974.service
curl -fsS --retry 5 --retry-connrefused --max-time 20 https://server-1.barbel-hops.ts.net:18974/models -D wasm/reports/credentialless-20261118/private-after.headers -o wasm/reports/credentialless-20261118/served.html
cmp wasm/reports/credentialless-20261118/served.html wasm/build/credentialless-candidate-20261118/index.html
grep -qi '^cross-origin-embedder-policy: credentialless' wasm/reports/credentialless-20261118/private-after.headers
systemctl --user is-active weborca-models-preview-18974.service
trap - ERR
