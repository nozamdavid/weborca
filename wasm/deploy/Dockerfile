# syntax=docker/dockerfile:1
# Build from the repository root; package the already-built Release WASM engines.
FROM node:22-bookworm-slim AS build
WORKDIR /workspace/wasm/app
ARG WASM_ARCH=64
ARG WASM_CFLAGS="-sMEMORY64=1 -pthread -fwasm-exceptions -O2"
ARG ORCA_EMSCRIPTEN_VERSION=6.0.11
ENV WASM_ARCH=${WASM_ARCH} WASM_CFLAGS=${WASM_CFLAGS} ORCA_EMSCRIPTEN_VERSION=${ORCA_EMSCRIPTEN_VERSION}
COPY wasm/app/package.json wasm/app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY wasm/app/ ./
COPY wasm/web/ /workspace/wasm/web/
COPY CMakeLists.txt /workspace/CMakeLists.txt
COPY version.inc /workspace/version.inc
COPY cmake/ /workspace/cmake/
COPY deps/ /workspace/deps/
COPY deps_src/ /workspace/deps_src/
COPY src/ /workspace/src/
COPY wasm/CMakeLists.txt /workspace/wasm/CMakeLists.txt
COPY wasm/engine/ /workspace/wasm/engine/
COPY wasm/preview/ /workspace/wasm/preview/
COPY wasm/step/ /workspace/wasm/step/
COPY wasm/deps/ /workspace/wasm/deps/
COPY wasm/scripts/ /workspace/wasm/scripts/
COPY wasm/build/runtime-identities/ /workspace/wasm/build/runtime-identities/
COPY wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs wasm/build/orca-wasm64/wasm/engine/orca_engine.wasm /workspace/wasm/build/orca-wasm64/wasm/engine/
COPY wasm/build/step-module/step_tessellate.mjs wasm/build/step-module/step_tessellate.wasm wasm/build/step-module/*.txt /workspace/wasm/build/step-module/
COPY wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.wasm /workspace/wasm/build/orca-wasm64-preview/wasm/preview/
COPY wasm/build/orca-wasm64/wasm/engine/runtime-manifest.json /workspace/wasm/build/orca-wasm64/wasm/engine/
COPY wasm/build/step-module/runtime-manifest.json /workspace/wasm/build/step-module/
COPY wasm/build/orca-wasm64-preview/wasm/preview/runtime-manifest.json /workspace/wasm/build/orca-wasm64-preview/wasm/preview/
COPY wasm/build/web/profiles/ /workspace/wasm/build/web/profiles/
COPY wasm/build/settings/layout.json /workspace/wasm/build/settings/layout.json
COPY resources/calib/ /workspace/resources/calib/
COPY resources/handy_models/ /workspace/resources/handy_models/
ARG MOBILE_SLICE_STEPS=layer_height,wall_loops,sparse_infill_density,sparse_infill_pattern,enable_support,support_type
ENV MOBILE_SLICE_STEPS=${MOBILE_SLICE_STEPS}
ARG VITE_ALPHA_GATE_ENABLED=0
ENV VITE_ALPHA_GATE_ENABLED=${VITE_ALPHA_GATE_ENABLED}
ARG VITE_COEP=require-corp
ENV VITE_COEP=${VITE_COEP}
RUN npm run build
COPY wasm/deploy/precompress.mjs /workspace/wasm/deploy/precompress.mjs
RUN node /workspace/wasm/deploy/precompress.mjs dist
RUN node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
const required = [
  'engine/orca_engine.mjs', 'engine/orca_engine.wasm',
  'engine/step/step_tessellate.mjs', 'engine/step/step_tessellate.wasm', 'step-worker.js',
  'orca_preview.js', 'orca_preview.wasm',
  'preview/orca_preview.js', 'preview/orca_preview.wasm',
  'profiles/index.json', 'settings/layout.json', 'engine-worker.js', 'orca-cloud-bridge.mjs', 'printer-cloud-bridge.mjs', 'alpha-access.mjs'
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
COPY --chown=node:node wasm/deploy/coep.mjs wasm/deploy/model-thumbnail.mjs ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.mjs"]
