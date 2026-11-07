# Prusa Connect manual callback capture

Current implementation (2026-11-04): capture preparation and strict full-URL/pending-attempt validation are [implemented and published on 5070](../wasm/build/tests-prusa-callback-capture/verification.txt) in `ui-prusa-capture-candidate-20261104`. Real code redemption remains unknown; Connect may consume or invalidate the code. The research, source findings and proposal below describe the pre-implementation state; see the current [setup flow](../wasm/app/PRINTERS.md#authentication--setup-flow) and [release QA receipt](../wasm/build/tests-prusa-callback-capture/qa/report.md).

Research date: 2026-11-04. Recommendation: keep the Connect client and its registered HTTPS callback, and offer browser Network-log capture before opening the authorization URL. This is the smallest supported way to recover the original callback URL after the address bar changes. Browser capture is documented; successful completion of a real Prusa OAuth login with that captured URL remains unverified.

## Redirect evidence

- The user confirms that `http://localhost:8175/oauth-callback.html` with public Connect client `MRHTlZhZqkNrrQ6FUPtjyusAz8nc59ErHXP8XkS4` produces **`Error: invalid_request / Mismatching redirect URI`**. Treat that as current provider evidence. No repeated login or localhost variation is needed.
- The established pair is that client ID with **`https://connect.prusa3d.com/login/auth-callback`**. Both the pinned [prusactl OAuth source][oauth] and [WebOrca gateway](../wasm/app/gateway/prusaConnect.ts) use it. A public GET of [Connect environment.js][environment] on the research date still advertised this client ID and `https://account.prusa3d.com`; that file alone does not disclose the redirect allowlist.
- A separate task owns rollback of the `95` service drop-in on port 5070 to the registered callback. This research neither inspected nor changed runtime configuration and does not claim rollback completion.
- Native PrusaSlicer has another client, `oamhmhZez7opFosnwzElIgE2oGgI2iJORSkw587O`, and `prusaslicer://login` in [its local ServiceConfig source](/home/david/PrusaSlicer/src/slic3r-shared/src/Slic3r/Biz/Network/ServiceConfig.cpp). That is evidence for a separate native configuration, not for registered localhost support or an authorized client-ID substitution.

The [initial local investigation](/home/david/PrusaSlicer/docs/prusa-connect-cli-investigation-2026-10-31.md) correctly described manual capture as upstream dependent. [RFC 6749 §§4.1.2–4.1.3][oauth-spec] binds the code to the client and redirect; the token request's redirect must equal the authorization request's redirect. [RFC 7636 §4.6][pkce-spec] requires the corresponding PKCE verifier. Copy the original URL intact. Rewriting an issued callback to localhost cannot change those bindings.

## What leaves the code visible, and what is unknown

The pinned [prusactl README, lines 222–233][manual-readme] says Connect's callback page leaves the code in the address bar when the returned state was not issued by that page. Its [manual implementation][manual] depends on that behavior and reads the URL from the user. Its full-query parser [requires matching state][oauth]; its bare-code path cannot verify returned state.

This is a third-party implementation's dated observation, not a current guarantee from Prusa. No current authenticated Connect callback was exercised here. There is no inspected evidence establishing that a private window, logging out of Connect, or having no existing Connect session reliably prevents the URL rewrite. Those conditions might affect routing, but recommending them as a fix would be speculation. An unknown WebOrca-generated state also does not guarantee that every current Connect route leaves the URL untouched.

When Connect navigates elsewhere or calls the History API to remove the query, the original callback document request can still be present in a Network log recorded beforehand. Capturing that request avoids relying on the final address bar. It does **not** stop Connect code from executing or guarantee that the authorization code remains usable.

## Manual capture in the user's existing browser

Use a desktop Chrome or Firefox browser with DevTools. Keep the WebOrca sign-in dialog and its single pending attempt open. Perform all URL copying locally between the browser and WebOrca; never paste callback URLs into chat, reports, or issue trackers.

1. Generate one WebOrca authorization link and retain that attempt's state and verifier. Before navigating to the link, open a separate blank tab in the existing browser and open its DevTools Network panel. Recording must start in **that tab**, before authorization navigation; DevTools attached only to the WebOrca tab will not record the other tab's callback.
2. **Chrome:** enable **Preserve log** and ensure recording is active. **Firefox:** enable **Persist Logs** in the Network Monitor's toolbar actions/settings menu. Leave DevTools open. Paste the WebOrca authorization link into this prepared tab's address bar and navigate. Sign in normally at Prusa Account.
3. If the final address bar still contains the complete registered callback with both `code` and `state`, copy that full URL. Otherwise, in Network, select **All** requests and filter for `auth-callback`. Find the navigation/document GET to `https://connect.prusa3d.com/login/auth-callback` whose query contains both `code` and `state`. Do not select the earlier Account authorization request, an API/token request, or the later query-free Connect page.
4. Right-click that callback request and choose **Copy → Copy URL** in Chrome or Firefox. This copies the request URL, including its query, rather than the browser's current address. Paste it directly into WebOrca's callback field and complete the same pending attempt promptly.
5. If the callback request was not recorded, start a new WebOrca attempt with recording already prepared. If WebOrca reports a state mismatch, expiry, or an already-used/invalid code, start a fresh attempt; do not edit state, redirect, or code to make it pass. Afterward clear the local Network log and sensitive clipboard contents.

The browser-owned documentation establishes the capture mechanics:

- [Chrome Network overview][chrome-overview]: requests are recorded while DevTools is open.
- [Chrome Network reference][chrome-reference]: **Preserve log** saves requests across page loads; **Copy URL** copies a selected request's URL.
- [Firefox Network toolbar][firefox-toolbar]: **Persist Logs** prevents clearing the log on navigation/reload.
- [Firefox request list][firefox-list]: the list represents requested URLs; **Copy → Copy URL** copies the selected URL.

These mechanics preserve an already-recorded callback request through later navigation, including a JavaScript redirect. A History API address-bar rewrite does not retroactively rewrite a past HTTP request. They cannot recover requests made before recording, logs cleared/closed by the user, or a callback that was never requested. They do not guarantee cross-tab capture. Avoid HAR export, Copy as cURL, resend, or reopening the callback; only the single callback URL is needed.

Capture and redemption are separate. A callback URL may remain in the log even if Connect has attempted to exchange the code, the code expired, or the provider invalidated it. RFC 6749 requires short-lived, single-use codes; Prusa's actual lifetime and behavior in these cases were not tested. Recording alone cannot guarantee successful login.

## Smallest implementation proposal

1. In [PrusaConnectLogin.tsx](../wasm/app/src/printers/PrusaConnectLogin.tsx), replace the instruction claiming a localhost error is expected with registered-callback guidance and the short Network capture fallback above. Add a local **Copy sign-in link** action so users can navigate in a prepared tab. Generate the attempt before navigation; remove the unconditional `window.open` on generation and retain an explicit open link for the ordinary address-bar path. This avoids an existing Account session completing the flow before recording can be enabled. Keep one pending attempt while the user copies either URL.
2. Keep the registered client/redirect pair and the same verifier throughout authorization and exchange. The existing full-URL paste field and `/auth/complete` transport already accommodate a URL copied from Network; no localhost callback listener, post-issuance URL rewrite, or new credential UI is needed.
3. Before shipping this path, tighten the existing [gateway callback parser](../wasm/app/gateway/prusaConnect.ts): require a full URL with the configured callback origin/path, one nonempty code, and one nonempty state exactly matching the active unexpired attempt. Reject missing/duplicate/mismatched state and the bare-code bypass. Use that attempt's original verifier and redirect for exchange. Currently `codeFromCallback` only rejects a state mismatch when a state parameter is present, accepts bare codes, and does not check callback origin/path; `/auth/complete` also accepts a request-supplied verifier. These observations are source findings, not changes made by this research.
4. Extend only [prusaConnect.test.mjs](../wasm/tests/node/prusaConnect.test.mjs) for the capture input boundary: an intact registered URL with matching pending state succeeds; missing/duplicate/wrong state, expired attempt, wrong callback, and bare code fail before token exchange; the successful mock exchange retains the original redirect and verifier. The current localhost fixture proves configuration propagation against a mock, not Prusa registration. A focused UI check should establish that generating the link does not navigate before the user prepares recording and that the copied link belongs to the same attempt. Build/type-check changed TypeScript during implementation; no production build is needed for this research note.

Automatic return from a regular browser tab to a WebOrca-owned callback requires an independently registered OAuth client and upstream configuration authorizing its exact callback, plus the corresponding WebOrca callback handling. That registration/configuration has not been established here. Reusing the existing Connect client cannot authorize a new WebOrca or localhost redirect. Manual Network capture preserves browser sign-in and local URL paste within the established pair. The subsequent [PrusaSlicer source trace](prusa-connect-automatic-callback.md) establishes an existing alternative: its server-side password/OTP bridge captures the registered callback from an upstream redirect before loading Connect, without a localhost OAuth redirect or DevTools. Reusing that bridge would require WebOrca to receive password/OTP input on its backend.

## Verification and scope

Read the requested local investigation, applicable skills/references, pinned upstream manual/OAuth sources, WebOrca login/parser/tests, and native client configuration. Checked the public links above using bounded, credential-free GETs; no authorization endpoints or token requests were invoked. No real account login, cookies, browser session, credentials, printer access, service changes, source edits, builds, or broad tests were used. Browser documentation was sufficient; no isolated fixture was needed. Only this research note was added.

[environment]: https://connect.prusa3d.com/environment.js
[manual-readme]: https://github.com/trevin-lee/prusactl/blob/d8b7b17d79c9c01ca1df7e923ec4f28fc6fc122e/README.md#L222-L233
[manual]: https://github.com/trevin-lee/prusactl/blob/d8b7b17d79c9c01ca1df7e923ec4f28fc6fc122e/internal/auth/manual.go
[oauth]: https://github.com/trevin-lee/prusactl/blob/d8b7b17d79c9c01ca1df7e923ec4f28fc6fc122e/internal/auth/oauth.go
[oauth-spec]: https://www.rfc-editor.org/rfc/rfc6749.html#section-4.1.2
[pkce-spec]: https://www.rfc-editor.org/rfc/rfc7636.html#section-4.6
[chrome-overview]: https://developer.chrome.com/docs/devtools/network/overview
[chrome-reference]: https://developer.chrome.com/docs/devtools/network/reference
[firefox-toolbar]: https://firefox-source-docs.mozilla.org/devtools-user/network_monitor/toolbar/index.html
[firefox-list]: https://firefox-source-docs.mozilla.org/devtools-user/network_monitor/request_list/index.html
