# syntax=docker/dockerfile:1
# Build from the repository root; package the already-built Release WASM engines.
FROM node:22-bookworm-slim AS build
WORKDIR /workspace/wasm/app
COPY wasm/app/package.json wasm/app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY wasm/app/ ./
COPY wasm/web/ /workspace/wasm/web/
COPY wasm/build/orca-step-runtime/wasm/engine/orca_engine.mjs wasm/build/orca-step-runtime/wasm/engine/orca_engine.wasm wasm/build/orca-step-runtime/wasm/engine/*.txt /workspace/wasm/build/orca-step-runtime/wasm/engine/
COPY wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.wasm /workspace/wasm/build/orca-wasm64-preview/wasm/preview/
COPY wasm/build/web/profiles/ /workspace/wasm/build/web/profiles/
COPY wasm/build/settings/layout.json /workspace/wasm/build/settings/layout.json
COPY resources/calib/ /workspace/resources/calib/
COPY resources/handy_models/ /workspace/resources/handy_models/
RUN npm run build
RUN node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const required = [
  'engine/orca_engine.mjs', 'engine/orca_engine.wasm',
  'orca_preview.js', 'orca_preview.wasm',
  'preview/orca_preview.js', 'preview/orca_preview.wasm',
  'profiles/index.json', 'settings/layout.json', 'engine-worker.js', 'orca-gateway.mjs'
];
for (const file of required) {
  const info = statSync(`dist/${file}`);
  assert.ok(info.isFile() && info.size > 0, `Missing packaged asset: ${file}`);
}
for (const file of ['orca_preview.js', 'orca_preview.wasm']) {
  assert.deepEqual(readFileSync(`dist/${file}`), readFileSync(`dist/preview/${file}`),
    `Preview aliases differ: ${file}`);
}
JS

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production ORCA_HOST=weborca.noz.am
WORKDIR /app
COPY --from=build --chown=node:node /workspace/wasm/app/dist/ ./dist/
COPY --chown=node:node wasm/deploy/server.mjs ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.mjs"]
