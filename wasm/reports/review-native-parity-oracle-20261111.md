# Current-source native cube oracle — 2026-11-11

PASS: independent Linux x86_64 native Print output and qualified WASM output have **zero normalized differing lines**, both for the initial cube and for the cube after canceling a Benchy slice. Each has 100 layers, 8802 G1 moves and summed extrusion 1306.8087. Expected G-code was exported by native `Print::process` / `Print::export_gcode`; no WASM G-code was used as a golden.

## Reproduction

From this checkout, using the already configured native build described in review-ci-final-qualification-20261111.md:

```sh
bash wasm/tests/parity/build-native-driver.sh wasm/build/review-native-oracle
ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs \
NATIVE_DRIVER=$PWD/wasm/build/review-native-oracle/native-parity-driver \
node wasm/tests/parity/current-native-cube.mjs
ORCA_ENGINE_MODULE=$PWD/wasm/build/review-preview-native/wasm/engine/orca_engine.mjs \
node --test --test-name-pattern='loadVendors lists|Slice the cube:|Cancel through' wasm/tests/node/engine.test.mjs
```

Last command: 3 tests pass, zero failures. The loadVendors test is required because this existing suite shares initialized state; selecting only the latter two tests fails its setup prerequisite. Both initial/recovery comparisons invoke the unchanged compare_gcode.sh normalizer. Browser runner syntax checked; browser execution and broader parity cases remain deferred.

## Build and configuration provenance

Git HEAD: `8e213616119d4a107f5ec90df1544e712de44094`. This is the shared working source, including existing uncommitted work. No source was copied from the parent checkout. Production source/build inputs were not edited; qualified runtime fingerprint remains the supplied `757eb10026bc7d34e114ae8c298203b0c6ba6cee147bef88ba6a349a140ca8c2`.

The script builds current-source `libslic3r` and `libnest2d`, extracts their configured compiler/link settings from Ninja, compiles the test-only native entry point and existing NanoSVG implementation, and links CMake's transitive native libraries. It bypasses the GUI-dependent OrcaSlicer main. No GUI dependencies or production entry-point guard is needed. The test entry point loads the cube, centers/arranges it on the configured bed, validates, processes and exports using actual native Print. The bounded harness is Voron-only.

Native dependencies are read-only `/mnt/appdata/workspace/OrcaSlicer/wasm/build/native-deps-headless/OrcaSlicer_dep/usr/local`, CGAL6.2.1 comes from this checkout's downloaded headers; Release static, GUI/CAD/PCH/OCCT/OpenVDB/OpenCV/Assimp/Draco/OpenSSL/Freetype disabled. Full cache and successful build/comparison/consumer logs are under `wasm/reports/native-parity-oracle-20261111/`. Link emits an existing TBB enum ODR warning; no dependency upgrade was attempted.

Selected current configuration: Voron 2.4 300 0.4 nozzle, 0.20mm Standard @Voron, Generic PLA @System. Only serialized configuration crosses from engine getConfig to native, not any toolpaths. The fixture INI preserves that exact config and native deserialization. Initial use of the existing spike JSON loader exposed escaped-newline differences (104 normalized lines) despite matching motion metrics; the new test entry point uses native set_deserialize via property-tree loading, resolving those real configuration differences without changing the comparator.

SHA256:

- Qualified engine module: `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7`
- Qualified engine WASM: `4492d1f174e448ba2d359ba3ca699ec46d54c85387b510ae335f1a49dd1ef07a`
- Native executable: `435ac45010cbf4eb1af79cc8c70620d37df994373de892626a50d6f18ec94489`
- Native G-code fixture: `a25047e48085e70a0d5c905d34258944a995a682dd77e12205e1e90b4342f0c3`
- Native INI configuration: `efd57835cc6fb17a565ac58e9e04f68c0092826000970756ae08e36896f629f2`
- WASM initial and recovery raw G-code: `cab376cc11826cbf53d7765719cbbd58ca2cd1851cb1eef22c912a0292dc0064`

## Consumers and remaining work

engine.test.mjs and browser/run.mjs now use refs-current-native/cube-voron.gcode for initial and recovery cube comparisons. run_parity.mjs and native-parity.mjs select that fixture only for cube-voron; other cases retain historical references and are unqualified. These broader runners still have old native CLI prerequisites and are not the bounded current-source oracle command above. No passing claim is made for them. General native/WASM speed qualification, public/hosted CI, UI build, and bed-fixture failures remain deferred to their owners.
