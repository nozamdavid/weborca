# WebOrca staging container

One container serves the current built web app on port **8080**, accepting `weborca.noz.am`.
There is no Caddy, TLS service or printer gateway running in the container. Slicing runs in browser
WASM; autosave stores recovery 3MF files in the browser's IndexedDB. The HTTP server sends the
COOP/COEP headers needed for multithreaded slicing.

## Build and run

From the repository root:

```sh
docker compose -f compose.staging.yaml up -d --build
```

Port 8080 is published on all interfaces. Route **https://weborca.noz.am** through your existing
HTTPS ingress/reverse proxy to the staging host's port 8080, preserving the Host header. Configure
DNS and TLS on that ingress. Public browser slicing needs HTTPS; localhost works over HTTP for
local checks.

To change the published port or bind only locally:

```sh
ORCA_PORT=8081 docker compose -f compose.staging.yaml up -d
ORCA_BIND_ADDRESS=127.0.0.1 docker compose -f compose.staging.yaml up -d
```

`ORCA_HOST` changes the accepted domain (default `weborca.noz.am`). Localhost and loopback addresses
are also accepted for health checks. Other Host headers return HTTP 421. App routes such as
`/calibration` use the SPA; missing WASM/profile files return 404 rather than HTML.

## Deploy the images elsewhere

The Dockerfile builds the frontend from current source with `npm ci` and `npm run build`, packaging
the existing Release WASM binaries, profiles, custom bed assets and example models. It does not
compile C++ inside Docker. The following build inputs must already exist:

- `wasm/build/orca-step-runtime/wasm/engine/orca_engine.mjs`, `orca_engine.wasm` and OCCT license texts
- `wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js` and `orca_preview.wasm`
- `wasm/build/web/profiles/`, including `index.json`, covers and bed assets
- `wasm/build/settings/layout.json`

Required packaged outputs are checked during the image build. The dedicated Dockerfile ignore file
excludes native source/build trees, node_modules and environment files. Rebuild the Release engines
before rebuilding the image when C++ slicing or preview code changes.

To transfer the current image without copying the WASM build trees:

```sh
docker image save weborca-staging-web:latest | gzip > weborca-staging-images.tar.gz
# Copy this archive and compose.staging.yaml to the staging host, then:
gunzip -c weborca-staging-images.tar.gz | docker image load
docker compose -f compose.staging.yaml up -d --no-build
```

You can also tag and push the image to your registry. Browser projects/settings survive container
restarts and updates as long as browser storage and the site origin remain the same. Recovery from
port 5070 does not automatically transfer to `https://weborca.noz.am`; export/import a 3MF to move
a project between these origins.

## Run the printer gateway manually

Download `orca-gateway.mjs` from the web app and run it on a machine that can reach your printer:

```sh
node orca-gateway.mjs --allow-origin https://weborca.noz.am --readonly --proxy 192.168.0.238
```

This permits status/filament reads and blocks uploads, print starts and controls. Configure the
printer connection to use the local gateway, normally `http://127.0.0.1:5199`. LAN access is from
that gateway machine, not from the staging container. See [printer connection details](../app/PRINTERS.md).

## Check and operate

```sh
docker compose -f compose.staging.yaml ps
docker compose -f compose.staging.yaml logs --tail=100
node wasm/deploy/smoke.mjs http://127.0.0.1:8080
docker compose -f compose.staging.yaml down
```

The smoke check verifies real WASM delivery, isolation headers, app routes, Host restrictions and
the absence of an app-server printer gateway. The container runs as a non-root user, has a health
check and restarts automatically. Unversioned assets use revalidation caching; hashed Vite assets
are immutable.
