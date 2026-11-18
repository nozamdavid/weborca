# MakerWorld account download — 2026-11-18

The Models browser resolves the default MakerWorld print profile through the existing explicitly enabled Bambu Cloud account bridge, then opens the returned HTTPS CDN URL as a browser download. Users import that downloaded 3MF in Prepare. It uses the first saved global Bambu Cloud printer account; sign in through printer settings first. China accounts are excluded. No new service, arbitrary URL proxy, model byte relay, CDN bearer, frontend-site bearer, or signed URL logging was added. Metadata is limited to numeric design/instance routes and the exact `type=download` query. Redirects and non-JSON responses are rejected; responses are uncached and capped at 2 MB.

## Actual upstream behavior

Inspected the supplied [skill](https://github.com/mvanhorn/printing-press-library/blob/main/cli-skills/pp-makerworld/SKILL.md), [Go command](https://github.com/mvanhorn/printing-press-library/blob/main/library/media-and-entertainment/makerworld/internal/cli/download.go), client and configuration. Default API base is `https://api.bambulab.com/v1`. The Go command requires MAKERWORLD_TOKEN, resolves a default instance, calls `/design-service/instance/{id}/f3mf?type=download`, and copies the HTTP response body directly to a `.3mf` file. Its comment assumes redirects to a CDN; it does not parse a JSON signed URL response. Thus its success message alone does not establish a valid 3MF.

Parent-verified live account evidence: instance 834969 returned HTTP 200 JSON with `name`, `url`, `highCompression`; URL host was `makerworld.bblmw.com`. A fresh CDN range GET without bearer and with WebOrca Origin returned 206, bytes 0–3/18975316, ZIP magic 50 4b 03 04, and no ACAO. This supports browser navigation/download, not in-app fetch/import. No account token or signed URL is retained in this report.

Bambu login returns `accessToken` and may return `refreshToken`; the latter now survives the existing saved-printer storage flow. Verification-code challenges still stop before preference/device reads. Renewal is bounded to one retry after 401, shares concurrent requests, and checks saved credential identity before updating or accepting reads. Logout, deletion and replacement cannot restore old credentials through late renewal. Persistence still occurs through the existing Save action and browser printer storage; passwords remain transient.

The documented account route is `POST /v1/user-service/user/refreshtoken` with `{refreshToken}` and historical response fields `accessToken`, `refreshToken`, `expiresIn`, `refreshExpiresIn`. [The community contract](https://github.com/Doridian/OpenBambuAPI/blob/main/cloud-http.md#post-v1user-serviceuserrefreshtoken) warns that it now returns only 401 and refresh tokens often equal access tokens. A mock invalid-token probe against the real endpoint returned 401. The code supports a valid returned token pair, but successful real renewal is **not verified or promised**. Rejected renewal requires signing in again. No website cookie refresh route or unsupported alternate token fields are guessed.

## Validation and private rollout

- 14 focused tests pass: Bambu client, gateway, and catalog. Mock credentials cover verification challenge, token retention, renewal request fields, retry bounds, shared concurrent renewal, logout during renewal, signed URL host validation, exact query preservation, blocked redirects/arbitrary queries, and cloud opt-in.
- TypeScript, all 22 locale catalogs, and Vite UI compilation pass. The full npm build stops in native packaging because `wasm/build/runtime-identities/engine.json` is absent. This is not a passing native release build.
- Hosted bridge compiled with esbuild. Private preview now serves `wasm/build/makerworld-candidate-20261118` on existing tailnet :18974. It combines the retained native runtime with this UI and bridge. The `60-makerworld.conf` user service override changes only ORCA_ROOT. Rollback: remove that override, daemon-reload and restart `weborca-models-preview-18974.service`; the previous candidate remains intact.
- Browser at localhost:18974/models rendered 32 catalog cards and 32 Download 3MF controls. Canonical-origin HTTP status confirms only bambu-cloud enabled. No public deployment occurred.
- Candidate index SHA-256: `8602bf52d188e70c982e09d7afd99c1d9a59ab2be4440f40e9dc4b84567b31d5`; bridge SHA-256: `631048e2244d068c7fec2012eeb1d60cfdf41fec2f3b0b5a602fdc006bda0f13`.

## Actual limits

Parent account endpoint/CDN evidence is separate from the mocked automated checks. Real successful refresh, browser download completion/pop-up policy, full 3MF import, multiple-account selection UX and native runtime source identity qualification remain unverified. No user secrets were used in automated tests. Native assets were retained from the earlier private demo; no new slicing qualification is claimed. Taproot milestone coordination remains with the parent task.

## Standalone account follow-up

The current private preview adds printer-independent sign-in under Help and the mobile menu, prefers that account for Download, and retains the saved-printer fallback. Separate storage, provider expiry, timer/resume renewal, mock browser evidence and the current `70-bambu-account.conf` rollback are recorded in [standalone account verification](bambu-standalone-account-20261118.md). That report supersedes the saved-printer prerequisite and private candidate above.
