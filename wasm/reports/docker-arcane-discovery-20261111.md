# Arcane Docker discovery — 2026-11-11

Read-only discovery against actual local Docker, Arcane project files/database and Docker Hub. No build, push, deployment, configuration or Taproot changes. Source HEAD `dc7c38f183d21b625c2524efab6538da9b260830`. Existing preview processes and unrelated edits preserved.

## Gate decision for pending build

**Build with `VITE_ALPHA_GATE_ENABLED=0`; keep runtime `ORCA_ALPHA_GATE_ENABLED` unset (disabled) to preserve actual Arcane behavior.** The current container has only `ORCA_HOST=weborca.noz.am` beyond base-image environment; neither gate variable nor cloud opt-in variables are set. Its `/app/dist/alpha-access.mjs` and `orca-cloud-bridge.mjs` do not exist. Public `/` returns HTTP 200 without authentication. The historical build argument cannot be recovered from image labels (none exist); the recommendation describes equivalent current behavior, not an assertion about its original build command. The gate is independent of the protected private preview on 5065.

Current source checks the build flag in `wasm/app/src/main.tsx` and runtime flag in `wasm/deploy/server.mjs`. Enabling either now would change the deployed access policy. No such change is needed for this rollout.

## Actual deployment identity

| Item | Verified value |
| --- | --- |
| Docker context / target | `default`, local Unix socket; Linux amd64 |
| Arcane manager | `arcane-arcane-1`, `ghcr.io/getarcaneapp/manager:v2.10.2` |
| Arcane base | `http://127.0.0.1:30258`; `/api/health` returns `UP` |
| Environment | `0`, `Local Docker`, online/enabled; database API URL `http://localhost:3552` is an internal stored value, not the host published port |
| Project | `weborca-staging`, ID `2372e868-f733-4b38-9b75-1f59a82be670` |
| Project files | Host `/mnt/appdata/apps/arcane/projects/weborca-staging/{compose.yaml,.env}`; manager sees `/app/data/projects/weborca-staging` |
| Services | Exactly **one**, `web`; no gateway, cloud or gate service |
| Container | `weborca-staging-web-1`, running/healthy |
| Image | `docker.io/dmarcosm/orcaweb:latest` (compose omits tag) |
| Running image / remote latest digest | `sha256:cfff3fcfc61b9139d9ef7527f60b984b0805e848610f367f172d55b6edac978e` |
| Image creation | 2026-10-12T06:42:05.450488053Z |
| Binding | `0.0.0.0:8932` → container TCP 8080 |
| Resources | init enabled; memory and swap each 536870912 bytes; restart `unless-stopped` |
| Storage / network | No mounts or named volumes; `weborca-staging_default` |

Local image also has tags `weborca-staging-web:latest`, `weborca-staging-web:performance-20261012`, and `weborca-staging-web:rollback-20261104-preserved-123954-1516572`, plus digest references under both repository names. Project auto-update is false; no GitOps manager is set.

The project `.env` contains legacy NGINX/POSTGRES variable names; values were not displayed. None are consumed by this service's rendered configuration. Preserve the file. There is no active gate/cloud secret mount or environment reference. The separate `~/.config/weborca/alpha.env` belongs to other local hosting context and is not referenced here. Do not transfer private-preview secrets or opt-ins implicitly.

Unrelated: Arcane project `orca` (`11499e40-49f6-43cb-a58b-46c203ef2ced`) uses `lscr.io/linuxserver/orcaslicer:latest`; native Prusa `prusaweb-*`, public 5070, private 5065/PID1945807, proxies and other Docker projects are outside this rollout.

## Registry and update access

Docker CLI credentials are configured in `~/.docker/config.json` for Docker Hub, identity **dmarcosm**, inline auth with no credential store/helper. They were read through `jq` into shell variables without printing secret values. A read-only Docker Hub token request for `repository:dmarcosm/orcaweb:pull,push` returned **both pull and push grants**. An authenticated registry HEAD for `latest` returned HTTP 200 and the digest above. Publishing access is available; no login or user secret request is needed. No push was attempted.

Arcane's `container_registries` record has URL `docker.io`, username `dmarcosm`, generic type, enabled, nonempty token. Token values were not read. This confirms configured pull access, though a fresh pull through Arcane was not executed.

Arcane's live [OpenAPI](http://127.0.0.1:30258/api/openapi.json) documents `X-API-Key` and Bearer JWT authentication. The database currently has **zero API-key records**; no reusable Arcane API login credential was found in the inspected local configuration paths. Manager environment contains JWT/encryption secrets, but those were not displayed or used to fabricate authentication. Authenticated API mutation is therefore unverified, not required for local rollout: passwordless `sudo -n` can read the existing project files and Docker daemon access works.

API mechanism, if an existing authenticated session becomes available: `PUT /api/environments/0/projects/2372e868-f733-4b38-9b75-1f59a82be670` accepts `composeContent` (preserve existing env content); then `POST .../update-services` with `{"services":["web"]}` pulls and recreates that service. `/up` accepts `forceRecreate`, `pullPolicy`, `recreateVolumes`, `removeOrphans`. No endpoint was mutated. `/redeploy` explicitly does down + up and is unnecessary here.

## Concrete authorized rollout recipe for parent

1. Use the already qualified isolated context described in [Docker build preparation](docker-image-build-20261111.md). Build only target `web`, `--platform linux/amd64`, explicit `--build-arg VITE_ALPHA_GATE_ENABLED=0`, and its documented runtime identity arguments. Suggested immutable publishing tag: `docker.io/dmarcosm/orcaweb:review-dc7c38f183-20261111`. Keep existing `latest` until candidate smoke passes.
2. Smoke the image on an unused loopback port with current production environment (`ORCA_HOST=weborca.noz.am`, runtime gate disabled); verify health, headers, worker/runtime assets and qualified hashes as specified by the build report. Do not reuse 5065, 5070 or 8932 for smoke.
3. Push that immutable tag using configured Docker CLI credentials. Resolve and record its registry digest. Save original project compose/env and old digest in a private backup outside the repository; preserve the old local image/tag and avoid prune.
4. With `sudo` plus `apply_patch`, change only `services.web.image` in the existing Arcane project compose to `dmarcosm/orcaweb@sha256:<verified-new-digest>`. Preserve port, limits, environment and all other fields. Validate with `sudo -n docker compose -p weborca-staging -f /mnt/appdata/apps/arcane/projects/weborca-staging/compose.yaml config --quiet`.
5. Run `sudo -n docker compose -p weborca-staging -f /mnt/appdata/apps/arcane/projects/weborca-staging/compose.yaml pull web`, then the same command prefix with `up -d --no-deps web`. This uses Arcane's existing canonical project files and Compose project identity; Arcane observes the same Docker resources. No API credential is needed for this path. Do not replace the project with the repository staging compose (its defaults differ).
6. Verify container image digest/health and origin/public checks below. Refresh Arcane read-only project/runtime state. Parent can then update README/Taproot with deployment evidence. No further user question is needed for the already authorized build/push/rollout.

Rollback: restore the original compose (or set only its image to `dmarcosm/orcaweb@sha256:cfff3fcfc61b9139d9ef7527f60b984b0805e848610f367f172d55b6edac978e`), validate, and run the same scoped `up -d --no-deps web`. The old image is locally available and remote latest currently matches. No persistent container volumes need migration; a newer server's in-memory sessions will reset on replacement. Never prune the rollback image during qualification.

## Verified health and origin

- `curl -fsS -H 'Host: weborca.noz.am' http://127.0.0.1:8932/healthz`: HTTP 200.
- `https://weborca.noz.am/healthz`: HTTP 200.
- `https://weborca.noz.am/`: HTTP 200, `COOP: same-origin`, `COEP: require-corp`, `Cache-Control: no-cache`; last modified 2026-10-12, consistent with the old container rather than current5070 docs.
- Image healthcheck fetches `http://127.0.0.1:8080/healthz`, every 30s, timeout 5s, start period 10s.

These checks establish reachable endpoints, not the complete reverse-proxy routing configuration. An arbitrary `/alpha-access/status` GET returns SPA fallback 200 on this old deployment and is not evidence of an active gate.

Evidence: selected `docker inspect` / `docker image inspect`, sanitized `docker compose config --format json`, read-only SQL selecting identity/configuration fields from Arcane's PostgreSQL, local live OpenAPI schemas, Docker Hub scoped token grants and manifest HEAD. Commands and report links were checked; documentation-only work requires no compile/test suite. No credentials or full secret-bearing compose/env content were recorded.
