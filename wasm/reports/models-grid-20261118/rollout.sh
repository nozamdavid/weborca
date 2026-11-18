#!/usr/bin/env bash
set -euo pipefail
base=wasm/build/bambu-session-recovery-candidate-20261118
candidate=wasm/build/models-grid-candidate-20261118
evidence=wasm/reports/models-grid-20261118
unit=weborca-models-preview-18974.service
drop="$HOME/.config/systemd/user/$unit.d/95-models-grid.conf"
test ! -e "$candidate"
test ! -e "$drop"
cp -a "$base" "$candidate"
cp -a wasm/build/models-grid-ui-20261118/assets/. "$candidate/assets/"
cp -a wasm/build/models-grid-ui-20261118/index.html "$candidate/index.html"
(cd "$base" && find . -type f ! -path './assets/*' ! -path './index.html' -print0 | sort -z | xargs -0 sha256sum) > "$evidence/base-retained.sha256"
(cd "$candidate" && find . -type f ! -path './assets/*' ! -path './index.html' -print0 | sort -z | xargs -0 sha256sum) > "$evidence/candidate-retained.sha256"
cmp "$evidence/base-retained.sha256" "$evidence/candidate-retained.sha256"
diff -rq "$base/assets" "$candidate/assets" > "$evidence/assets-diff.txt" || test $? = 1
(cd "$base" && find assets -type f -print0 | sort -z | xargs -0 sha256sum) > "$evidence/old-assets.sha256"
(cd "$candidate" && sha256sum -c "../../reports/models-grid-20261118/old-assets.sha256") > "$evidence/old-assets-check.log"
echo '708cb015be444c2b9709ba31ddae570d275cf6ba3d98f14bbd045c047dac00c7  printer-cloud-bridge.mjs' | (cd "$candidate" && sha256sum -c -)
sha256sum "$HOME/.config/systemd/user/$unit.d/80-makerworld-relay.conf" > "$evidence/80-before.sha256"
rollback() {
 rm -f "$drop"
 systemctl --user daemon-reload
 systemctl --user restart "$unit"
 echo 'ROLLED BACK by removing only 95-models-grid.conf'
}
trap rollback ERR
printf '[Service]\nEnvironment=ORCA_ROOT=%s/%s\n' "$PWD" "$candidate" > "$drop"
systemctl --user daemon-reload
systemctl --user restart "$unit"
systemctl --user is-active "$unit"
sha256sum -c "$evidence/80-before.sha256"
bash "$evidence/verify.sh"
trap - ERR
