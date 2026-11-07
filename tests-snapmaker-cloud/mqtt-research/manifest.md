# Public MQTT research evidence

Fetched 2026-11-05. Only public static GitHub source and Amazon's public root certificate were fetched. No authentication, email, certificate issue, broker/device or private account requests were made. Findings: [MQTT contract](../../docs/snapmaker-cloud-mqtt.md).

All Snapmaker paths below are rooted at:

```text
https://raw.githubusercontent.com/Snapmaker/OrcaSlicer/6dd88c98f9cbc4954e4d58b02caf26d2acc7a18c/
```

Excerpt text uses `originalLineNumber:verbatimSourceLine`; gaps are deliberate. The compiled Flutter SHA-256 matches the earlier `wasm/build/tests-snapmaker-cloud/research/manifest.md` evidence. Full large source downloads were removed after extracting the cited sections. Hashes of retained files are in [SHA256SUMS](SHA256SUMS), with paths relative to the repository root.

| Retained file | Public source path | Full source SHA-256 |
| --- | --- | --- |
| [flutter-excerpts.txt](flutter-excerpts.txt) | `resources/web/flutter_web/main.b347974c91352c2f.js` | `b347974c91352c2f912471e71659a4d2f96d69c9772a9fc2430f4dee7ad577d5` |
| [mqtt-excerpts.txt](mqtt-excerpts.txt) | `src/slic3r/Utils/MQTT.cpp` | `43746744677fe9287ab1edc1226d5608819900da0f6290596843e4738577cf28` |
| [moonraker-excerpts.txt](moonraker-excerpts.txt) | `src/slic3r/Utils/MoonRaker.cpp` | `8946b60295e59493f0ed711f95656d38473127cbce1e8335548bc984bbc1542b` |
| [paho-message-excerpts.txt](paho-message-excerpts.txt) | `src/mqtt/include/mqtt/message.h` | `b4d0788729b4834f7d1407bc382db701dab2459992136742dfc445fc3a467f80` |
| [TimeSyncManager.cpp](TimeSyncManager.cpp), full 108 lines | `src/slic3r/Utils/TimeSyncManager.cpp` | `e146edfe287d432150f256aac9201c784ac42f8f1c06cbcf9b8dfc6a4d3b3090` |
| [orca-root-ca.pem](orca-root-ca.pem) | Decoded `\\n` escapes in Flutter original line 36657, removed surrounding `q="..."` | Same PEM hash as Amazon below |
| [AmazonRootCA1.pem](AmazonRootCA1.pem) | https://www.amazontrust.com/repository/AmazonRootCA1.pem | `2c43952ee9e000ff2acc4e2ed0897c0a72ad5fa72c3d934e81741cbd54f05bd1` |

Flutter retained ranges: 35185–35224, 35322–35348, 35405–35410, 35575–35614, 36648–36663, 36700–36722, 43802–43848, 138675–138687, 138750–138758, 139069–139072, 139215–139250, 139748–139953, 141650–141665, 141835–141866, 141968–142064, 142108–142117, 142188–142198, 142250–142290, 142436–142478, 156406–156453, 156535–156552, 159369–159375, 165070–165105, 165215–165280, 168100–168125, 168145–168165, 168307–168358, 168390–168433, 168510–168548, 168616–168635, 168637–168644, 168647–168661.

MQTT retained ranges: 21–52, 64–140, 233–267, 276–294, 345–358, 591–632, 662–700.

MoonRaker retained ranges: 806–810, 1132–1168, 1257–1265, 1302–1332, 1402–1440, 1644–1687, 2544–2600, 2749–2796, 2799–2830, 2855–2887.

Paho message header retained ranges: 56–73, 119–143.

Additional bounded discovery reads: public GitHub recursive tree for the same commit; `src/slic3r/GUI/SSWCP.cpp`, `src/libslic3r/SSWCPProtocol.cpp`, `src/slic3r/Utils/NetworkAgent.cpp`, `src/mqtt/src/message.cpp`. These were used to find transport boundaries; no findings depend on unretained quotations from them. Existing local Bambu/hosted gateway files were read for architectural context only and not copied into this public evidence set.

The literal scan `amazonaws|wss://|\.iot\.` returned no matches in the **full** pinned Flutter bundle, MQTT.cpp and MoonRaker.cpp. This is a bounded negative finding, not proof that Snapmaker has no WSS service or that no other source contains a hostname. Dynamic credential results were intentionally not fetched.

Validation from the repository root:

```sh
sha256sum -c tests-snapmaker-cloud/mqtt-research/SHA256SUMS
cmp tests-snapmaker-cloud/mqtt-research/orca-root-ca.pem tests-snapmaker-cloud/mqtt-research/AmazonRootCA1.pem
openssl x509 -in tests-snapmaker-cloud/mqtt-research/orca-root-ca.pem -noout -subject -issuer -dates -fingerprint -sha256
```

Both PEMs are identical, including formatting. The certificate SHA-256 fingerprint is `8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E`. These are public CA certificates, not user certificates or private keys.

All source downloads succeeded with `curl -LfsS`; local document targets and citation definitions were checked. No production edits/tests/builds/services, commits, README or Taproot updates were made. Research sub-agent did not delegate.
