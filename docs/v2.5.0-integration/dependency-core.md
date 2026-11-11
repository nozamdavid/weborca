# v2.5.0 dependency and core integration

Status: fresh CGAL 6.2.1 core archives and engine/driver modules built; focused
native regressions passed (2,053 assertions across 98 test cases).

The initial engine snapshot below is S1. Config runtime subsequently reproduced
slot-map deletion and no-op repair annotation bugs. The adapter owner is fixing
them; S1 is immutable historical evidence and does not qualify the changed
adapter sources. Core archives are unchanged. The settled S2 adapters were
subsequently compiled and linked into a separate snapshot, recorded below.

The isolated prefix is `wasm/build/prefix-v250-wasm64`; the fresh core build is
`wasm/build/orca-v250-wasm64`. Both are inside this integration worktree. The
reproducible configuration is in `wasm/build/v250-core-evidence/configure-wasm.sh`.
It enables Preview, uses bundled libigl, and preserves the GUI/optional dependency
gates. Preview owns a separate adapter build tree and uses this prefix.

The installed SDK is Emscripten 6.0.11, Clang 24.0.0git revision
`f718ebe873411a562ef6e5c27da36d75b7aaec98`. All WASM consumers use memory64,
`-pthread -fwasm-exceptions`, C++17 and one serialized build job. Heavy commands
run through the original `wasm/build/tests-mobile-polish/qa/run-capped.sh` with
`2G`; that runner shares `/tmp/webslicer-heavy.lock` and disables swap.
Tools are CMake 4.2.3 and Ninja 1.13.2. Base merge is
`709ff3ecd09824b4f2bd3a78f398c3a038811243`; no commits or branch changes were made.

## Dependencies

`wasm/deps/build_cgal.sh` now pins CGAL 6.2.1 and verifies the release SHA256
`eebd737d9b7f0199647ba5c1f9f6c7a3d0651aacef9c2fd4dedc52da6c25edbe` before
extraction. Installation succeeded with 245.5 MiB peak memory and no swap.
Configure succeeded with 164 MiB peak memory and no swap.

Unchanged dependencies were inspected in the original prefix read-only, then
copied into the isolated prefix excluding CGAL. Their original CMake caches use
the same memory64, pthread and WASM exception flags. Archive file headers,
producer sections, target features and SHA256 values are recorded in
`wasm/build/v250-core-evidence/archive-abi.txt`; build cache flags and the current
compiler are in `dependency-provenance.txt` beside it. No old libslic3r or other
CGAL-dependent object/archive was copied. Existing build caches remain untouched.

The foundation already includes the upstream CGAL 6 libigl template changes and
the private/public `CGAL_LINKED_WITH_TBB` definitions on `libslic3r_cgal` and
`libslic3r`. Configuration explicitly disables system libigl discovery so its
headers cannot override the merged bundled templates.

## Commands and evidence

From the integration worktree, prefix installation and configuration use:

```sh
runner=/mnt/appdata/workspace/OrcaSlicer/wasm/build/tests-mobile-polish/qa/run-capped.sh
root=/home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1
bash "$runner" v250-cgal 2G bash -c 'cd /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1 && WASM_PREFIX="$PWD/wasm/build/prefix-v250-wasm64" WASM_JOBS=1 bash wasm/deps/build_cgal.sh'
bash "$runner" v250-configure 2G bash "$root/wasm/build/v250-core-evidence/configure-wasm.sh"
bash "$runner" v250-core-build 2G bash -c 'cd /home/david/.t3/worktrees/OrcaSlicer/t3-c8aa6ae1 && cmake --build wasm/build/orca-v250-wasm64 --target libslic3r_cgal libslic3r -j1'
```

Logs are `wasm/build/v250-core-evidence/{cgal-install,configure-wasm,core-build}.log`.
The engine owner signaled settled sources before final compilation. Final
module and native regression evidence is below.

## Concrete build fixes and intermediate validation

The original combined `MeshBoolean.cpp` reached the 2 GiB cgroup cap at Release
`-O3`, then again with a final `-O1` and `-O0`. Both lower-optimization failures
occurred in about 11 seconds, pointing to accumulated template instantiation
rather than a long optimization pass. Logs: `core-build.log`,
`meshboolean-o1.log`, `meshboolean-o0.log` in the evidence directory.

The independent existing libigl conversion/difference/self-union bodies moved
unchanged into `src/libslic3r/MeshBooleanIGL.cpp`. The public header/API, CGAL
types, exceptions and target definitions remain shared through the existing
`libslic3r_cgal` target. No heavy implementation header was introduced. A new
`ORCA_WASM_MESH_BOOLEAN_OPTIMIZATION` cache string allows a reproducible override
for that source only; this candidate passes `-O1`. The extracted libigl source
uses normal Release optimization in this Preview-enabled configuration.

The split first passed with the main unit at `-O0` and libigl at `-O3`, peaking at
1,708,179,456 bytes. The final CGAL archive passed with the main unit at `-O1`,
peaking at 1,741,131,776 bytes and zero swap (`cgal-final.log`). Runtime geometry
regressions passed below; runtime performance has not been measured.

The original optimization sequence was `-sMEMORY64=1 -pthread
-fwasm-exceptions -O2` followed by Release `-O3 -DNDEBUG`; retries append `-O1`
and then `-O0` to that same sequence. The final split candidate appends `-O1`
only for `MeshBoolean.cpp`. Complete final compile commands (including C++17,
all definitions and include paths) are `meshboolean-final-commands.txt`; the
native command is `native-meshboolean-final-command.txt` in the evidence folder.

The focused merged object batch passed: `Arrange.cpp`, `Fill/FillBase.cpp`,
`Format/bbs_3mf.cpp`, `GCode.cpp`, `GCode/GCodeProcessor.cpp`,
`PerimeterGenerator.cpp`, `Print.cpp`. Peak was 1,577,119,744 bytes, zero swap
(`merged-units.log`). The final processor rebuild below includes the settled
parent-owned cooling fallback fix.

Native configuration initially failed on the unconditional exact bundled Python
3.12.13 discovery. All linked `pybind11::embed` consumers are GUI targets:
`libslic3r_gui`, its stubgen module, and GUI-only `slic3rutils_tests`. Root CMake
now gates bundled Python discovery on `NOT EMSCRIPTEN AND SLIC3R_GUI`, preserving
desktop GUI behavior. Headless native tests then configured successfully
(`configure-native-gated.log`). Native unchanged Boost/TBB archives were built
with the installed GCC 15.2.0; the native candidate uses those read-only plus
native GMP/MPFR. The first native attempt exposed header contamination: CGAL's
include root also exposed the full WASM prefix's TBB 2023.1.0 headers ahead of
the native archive's TBB 2021.5.0 headers. That attempt was stopped before
linkage and its objects are unused. The corrected native tree is
`wasm/build/orca-v250-native-coherent`, with a separate
`wasm/build/prefix-v250-native-headers` containing only CGAL and Eigen headers
and package data. It never links WASM archives or selects WASM TBB headers.
GCC garbage collection parameters (`--param=ggc-min-expand=10
--param=ggc-min-heapsize=32768`) and native Release `-O1 -DNDEBUG` still exceeded
the 2 GiB cap in the corrected native geometry compile
(`native-coherent-meshboolean.log`). That attempt is unused. The current native
candidate is `wasm/build/orca-v250-native-clang`, using installed Clang 21 with
explicit `-stdlib=libstdc++` and `-O1 -DNDEBUG`. CMake's compiler ABI check selects
the same GCC 15 libstdc++ headers/library used by the unchanged native archives;
see `native-clang-abi.txt` and `configure-native-clang.log`. Archive hashes,
native TBB version, and compiler provenance are in
`native-dependency-provenance.txt`.

The native Clang geometry archive completed with 1,724,100,608 bytes peak and
zero swap (`native-clang-geometry.log`). This validates the independently rebuilt
native geometry backend; the subsequent focused runtime regressions passed.

The first non-memory core compile failure was `Geometry/VoronoiUtilsCgal.cpp`:
CGAL 6's generic `Surface_sweep_2_algorithms.h` unconditionally includes default
rational-curve traits, pulling Boost.Interval hardware rounding that WASM lacks.
The one segment intersection call now constructs the same CGAL segment sweep
and `Intersection_points_visitor` directly with `report_endpoints=false`. It
avoids unused rational traits without changing arithmetic policy. The WASM unit
now compiles. Failure evidence is
`initial-core-batches/core-batch-6.log`; native comparison with the original
generic algorithm on three Voronoi diagrams is in the focused regression target.

All engine source objects compiled after adapter-owner fixes for object-level
`auto_drop`, the new paint-selection up-direction parameter, and the
`Slic3r::repair_mesh` interface. These adapter files are owned by the config
worker. Evidence: `engine-adapter-units.log`, `engine-objects-final.log` (contains
the last repair error while continuing to compile the other objects), and
`repair-adapter.log` (final successful repair compile, 878,657,536-byte peak).
The final module link below includes these adapter fixes.

The complete WASM core archive built successfully. Native Clang's stricter
`-Werror` then exposed an unused `normal_mode` capture in the parser's
`compute_bucket` lambda. Removed only that capture; the parent-owned cooling
fallback changes in the same file were preserved. The parser and archive were
refreshed before final engine/Preview hashes were reported. Initial native failure
evidence is `initial-native-batches/native-batch-5.log`; final refresh command
and link evidence are in `engine-stable-link.log`.

The final processor rebuild and archive refresh passed at 1,172,467,712 bytes
peak with zero swap (`core-archive.log`). Ninja reports no remaining work for
`libslic3r`. Stable archive SHA256 values are:

| Archive under `wasm/build/orca-v250-wasm64/src/libslic3r` | SHA256 |
| --- | --- |
| `liblibslic3r.a` | `0c406e4372ac7a6f31c8468b35e37119841adf9eaaf3dd53198d32e570bef025` |
| `liblibslic3r_cgal.a` | `e61216d58dd25b7b4fae25a8714216579166233c66b51c3c9929738f3994bec9` |

The same values are in `wasm-core-archive-hashes.txt`. Preview was notified to
bind this corrected archive generation. The first engine/driver target build
completed with 1,097,838,592 bytes peak and zero swap (`engine-final-link.log`);
its pair is superseded by the final relink against the corrected archive.

The final corrected engine/driver link passed with 830,918,656 bytes peak and
zero swap (`engine-stable-link.log`). The engine pair was copied together into
the read-only snapshot `wasm/build/v250-engine-module`, and both parent/config
owners were notified for integration testing. Snapshot SHA256 values:

| File | SHA256 |
| --- | --- |
| `orca_engine.mjs` | `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` |
| `orca_engine.wasm` | `393dee1b4822ec060c372ada3d42586e6288456ffa1b318cbab02005b439fccb` |

`SHA256SUMS` is beside the pair. The driver pair is
`wasm/build/orca-v250-wasm64/wasm/spike/orca_slice_driver.{js,wasm}`. Build command:

```sh
bash "$runner" v250-engine-stable-link 2G bash "$root/wasm/build/v250-core-evidence/build-core-batch.sh" orca_engine orca_slice_driver
```

The final engine snapshot passed module initialization, Engine construction and
deletion, and submit-binding presence under the same cap (`engine-init.log`),
with peak memory 402,776,064 bytes and zero swap. Integration behavior belongs
to the config and Preview owners' matching-module runtime checks.

After the config owner signaled S2 settled, `Engine.cpp` and `RepairOps.cpp`
were recompiled and `orca_engine` relinked (`engine-s2-link.log`), with
1,248,354,304-byte peak memory and zero swap. The source hashes in
`wasm/build/v250-config-evidence/s2-source-hashes.txt` matched both before and
after compilation. Core archives still match the stable hashes above. The new
read-only snapshot is `wasm/build/v250-engine-module-s2`, preserving S1:

| S2 file | SHA256 |
| --- | --- |
| `orca_engine.mjs` | `70a73013596f54046e2e490d1e01fbade6edff920eeb911ed649a05b820d18d7` |
| `orca_engine.wasm` | `452c0ab51a0b935f691384e629d73ad0005fda99733b059d18cc600c0d4c1f19` |

The config owner received the matching paths/hashes for S2 runtime verification.
The driver retains the earlier core-only build and does not include adapters.

The bounded-batch build scripts, exact configuration scripts, final source hashes,
archive ABI manifests and focused native regression sources are retained in
`wasm/build/v250-core-evidence`. Original build caches were not reused for core
objects. No deployment or push occurred.

All 39 original dependency archives still match the initial hashes:
`original-archives-unchanged.log`. The extracted libigl operation bodies match
the original byte for byte (`meshboolean-before-bodies.txt` and
`meshboolean-after-bodies.txt`).

To keep testing focused, a build-local CMake include creates
`v250_core_regressions` from the existing timing, GCodeWriter, MeshBoolean, 3MF
and adaptive infill tests, plus a small cube difference/self-union check of the
extracted libigl path. It uses the fresh native libslic3r target, not old objects.
The configuration script is `wasm/build/v250-core-evidence/configure-native.sh`;
the test target and smoke source are alongside it. Executed runtime filters are
`[MeshBoolean]`, `[GCodeTiming]`, `[PreheatSafety]`, `[CoolingFallback]`, the two
existing skipping-preview-interpolation preheat cases, `[3mf]`, and
`[AdaptiveInfillField]`, plus `[VoronoiSweep]` for the concrete CGAL header fix.

All 251 native core objects compiled. The focused target compiled the parent
cooling regression and passed **2,053 assertions across 98 test cases**, including
`[CoolingFallback]` with its required nonempty cooling-command assertion.
`native-regressions.log` records the filters, seed, full output and cap metrics:
85,618,688 bytes peak, zero swap, 1.614 seconds service runtime. Existing
`[MeshBoolean]` cases and the extracted libigl cube difference/self-union check
passed. The explicit segment sweep matched the original generic CGAL algorithm
on three nonempty finite Voronoi fixtures. This is bounded functional evidence;
no geometry or slicing performance comparison was performed.

Two build-local test harness issues were corrected: the Voronoi comparison
source needed `CGAL::CGAL` include propagation, and native TBB archives contain
GCC 15 LTO requiring the matching GCC link driver. The target uses
`link-native-gcc.sh` only as its linker launcher; all new core objects remain
Clang 21 with the verified GCC 15 libstdc++ ABI. Initial evidence is preserved as
`native-regressions-build-missing-test-include.log` and
`native-regressions-build-gcc-lto.log`; final link evidence is
`native-regressions-build.log` (428,417,024-byte peak, zero swap).

GCC LTO reports an existing oneTBB internal profiling `notify_type` enum mismatch
between that dependency's own `tbbmalloc/Customize.h` (four values) and
`profiling.h` (five values). Both paths are within the unchanged native TBB
2021.5 source tree. No warning was suppressed or dependency source changed;
the functional regression run passed. This native dependency warning remains
recorded and is not a claim that every dependency is warning-free.

Final native executable/archive hashes are in `native-final-hashes.txt`:
the executable is
`1e8b0232734bcca7b0f8d724a97d23133a0478ae090418f1e34b12402016cd1d`.
WASM core archives and S1/S2 snapshot hashes were rechecked after the native run.
Remaining integration work is the adapter owners' S2/config and Preview runtime
qualification, plus separately owned STEP dependency patch/parity work. No
remaining core compile or selected native test failure is known.

Native build and regression commands, run from this worktree:

```sh
bash "$runner" v250-native-configure 2G bash "$root/wasm/build/v250-core-evidence/configure-native.sh"
bash wasm/build/v250-core-evidence/build-native-batches.sh
bash "$runner" v250-native-regressions 2G bash "$root/wasm/build/v250-core-evidence/run-native-regressions.sh"
```

The batch script invokes the capped runner separately for each 24-object group,
then the focused test target. This releases the lock between batches for module
consumers. The final native parser compile includes the parent cooling guards
and the unused-capture correction.

Owned changed files: `wasm/deps/build_cgal.sh`, root `CMakeLists.txt`,
`src/libslic3r/CMakeLists.txt`, `src/libslic3r/MeshBoolean.cpp`, new
`src/libslic3r/MeshBooleanIGL.cpp`,
`src/libslic3r/Geometry/VoronoiUtilsCgal.cpp`, the unused lambda capture in
`src/libslic3r/GCode/GCodeProcessor.cpp`, and this report. Other edits to the
processor, tests, adapters and renderer belong to their concurrent owners.
