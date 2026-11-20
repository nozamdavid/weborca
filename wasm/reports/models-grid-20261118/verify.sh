#!/usr/bin/env bash
set -euo pipefail
evidence=wasm/reports/models-grid-20261118
candidate=wasm/build/models-grid-candidate-20261118
host=server-1.barbel-hops.ts.net:18974
origin=https://$host
fetch() {
 curl -sS --retry 4 --retry-connrefused --max-time 30 -H "Host: $host" -H "Origin: $origin" -D "$evidence/$2.headers" "http://127.0.0.1:18974$1" -o "$evidence/$2.body"
 ! rg -i '^clear-site-data:' "$evidence/$2.headers"
}
for route in models prepare preview; do
 fetch "/$route" "$route"
 cmp "$candidate/index.html" "$evidence/$route.body"
done
fetch / index
cmp "$candidate/index.html" "$evidence/index.body"
sed -n 's/.*src="\(\/assets\/[^" ]*\)".*/\1/p' "$candidate/index.html" > "$evidence/index-references.txt"
while read -r asset; do
 name=$(basename "$asset")
 fetch "$asset" "$name"
 cmp "$candidate$asset" "$evidence/$name.body"
 sha256sum "$candidate$asset" "$evidence/$name.body"
done < "$evidence/index-references.txt"
fetch /engine/orca_engine.mjs native-loader
cmp "$candidate/engine/orca_engine.mjs" "$evidence/native-loader.body"
fetch /_printer/status status
head -1 "$evidence/status.headers" | grep '200'
# Status contains only enabled-provider flags; no credentials.
cat "$evidence/status.body"
relay=/_printer/bambu-cloud/api/v1/design-service/model-bytes
code=$(curl -sS --max-time 15 -H "Host: $host" -H "Origin: $origin" -H 'Content-Type: application/json' -d '{"url":"https://example.invalid/model.3mf"}' -o "$evidence/relay-destination.body" -w '%{http_code}' "http://127.0.0.1:18974$relay")
test "$code" = 400; echo "foreign destination: $code"
code=$(curl -sS --max-time 15 -H "Host: $host" -H 'Origin: https://example.invalid' -H 'Content-Type: application/json' -d '{}' -o "$evidence/relay-origin.body" -w '%{http_code}' "http://127.0.0.1:18974$relay")
test "$code" = 403; echo "foreign origin: $code"
code=$(curl -sS --max-time 15 -H 'Host: example.invalid' -H "Origin: $origin" -o "$evidence/relay-host.body" -w '%{http_code}' "http://127.0.0.1:18974/_printer/status")
test "$code" = 421; echo "foreign host: $code"
sha256sum "$candidate/index.html" "$evidence/index.body" "$candidate/printer-cloud-bridge.mjs"
