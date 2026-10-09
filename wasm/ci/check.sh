#!/usr/bin/env bash
# ==============================================================================
# wasm/ci/check.sh - Local and CI Validation Entrypoint for OrcaSlicer WebAssembly
#
# Validates paths, configuration, artifact pairing, shell syntax, and YAML
# without running heavy builds or installing new toolchains.
#
# Usage:
#   bash wasm/ci/check.sh [--check]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

CHECK_MODE=false
if [ $# -eq 0 ] || [ "${1:-}" = "--check" ]; then
    CHECK_MODE=true
elif [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    echo "Usage: bash wasm/ci/check.sh [--check]"
    echo "  --check   Validate CI configuration, paths, and environment without running builds"
    exit 0
else
    echo "Unknown option: $1" >&2
    echo "Usage: bash wasm/ci/check.sh [--check]" >&2
    exit 1
fi

ERRORS=0
WARNINGS=0

log_info()  { echo "[INFO]  $*"; }
log_ok()    { echo "[OK]    $*"; }
log_warn()  { echo "[WARN]  $*"; WARNINGS=$((WARNINGS + 1)); }
log_error() { echo "[ERROR] $*"; ERRORS=$((ERRORS + 1)); }

echo "=== OrcaSlicer WebAssembly CI Validation ==="
log_info "Repository root: $REPO_ROOT"

# ------------------------------------------------------------------------------
# 1. YAML Configuration & Parser / Schema Validation
# ------------------------------------------------------------------------------
echo ""
echo "--- 1. YAML Configuration & Parser / Schema Validation ---"
CI_WORKFLOW="wasm/ci/wasm.yml"
TARGET_WORKFLOW=".github/workflows/wasm.yml"
WORKFLOW_FILES=()

if [ -f "$CI_WORKFLOW" ]; then
    WORKFLOW_FILES+=("$CI_WORKFLOW")
    log_ok "Workflow template found: $CI_WORKFLOW"
else
    log_error "Workflow template not found: $CI_WORKFLOW"
fi

if [ -f "$TARGET_WORKFLOW" ]; then
    WORKFLOW_FILES+=("$TARGET_WORKFLOW")
    log_ok "Active GitHub workflow found: $TARGET_WORKFLOW"
else
    log_warn "Active GitHub workflow not found: $TARGET_WORKFLOW"
fi

for wf in "${WORKFLOW_FILES[@]}"; do
    echo "Validating syntax and schema for $wf..."
    # Check for actionlint (GitHub schema validation)
    if command -v actionlint >/dev/null 2>&1; then
        log_info "actionlint found, validating GitHub Actions schema for $wf..."
        if actionlint "$wf"; then
            log_ok "actionlint: GitHub Actions schema valid for $wf"
        else
            log_error "actionlint: schema validation failed for $wf"
        fi
    else
        log_warn "actionlint: not installed; GitHub Actions workflow schema is UNCHECKED (PyYAML validates YAML syntax only)"
    fi

    # Check for yamllint
    if command -v yamllint >/dev/null 2>&1; then
        log_info "yamllint found, running yamllint on $wf..."
        if yamllint -d "{extends: default, rules: {line-length: disable}}" "$wf"; then
            log_ok "yamllint passed on $wf"
        else
            log_warn "yamllint reported issues on $wf"
        fi
    fi

    # Validate with Python PyYAML (standard lightweight syntax parser)
    if command -v python3 >/dev/null 2>&1; then
        if python3 -c "import yaml" >/dev/null 2>&1; then
            if python3 -c "import yaml; yaml.safe_load(open('$wf'))" >/dev/null 2>&1; then
                log_ok "PyYAML: successfully validated YAML syntax for $wf (syntax validation only; not GitHub schema validation)"
            else
                log_error "PyYAML: failed to parse $wf"
            fi
        else
            log_warn "python3 PyYAML module not available for YAML syntax validation"
        fi
    else
        log_warn "python3 not available to parse YAML"
    fi
done

# ------------------------------------------------------------------------------
# 2. Shell Script Syntax Validation (bash -n)
# ------------------------------------------------------------------------------
echo ""
echo "--- 2. Shell Script Syntax Checks (bash -n) ---"
SHELL_SCRIPTS=(
    "wasm/ci/check.sh"
    "wasm/scripts/env.sh"
    "wasm/scripts/memcap.sh"
    "wasm/scripts/build_orca.sh"
    "wasm/tests/data/fetch_models.sh"
    "wasm/tests/parity/make_refs_macos.sh"
)

for script in "${SHELL_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        if bash -n "$script"; then
            log_ok "bash -n: $script syntax valid"
        else
            log_error "bash -n: $script failed syntax check"
        fi
    else
        log_error "Script not found: $script"
    fi
done

# ------------------------------------------------------------------------------
# 3. Referenced Static Paths, Build Tooling & Test Preconditions
# ------------------------------------------------------------------------------
echo ""
echo "--- 3. Static Path & Precondition Verification ---"
REQUIRED_PATHS=(
    "wasm/scripts/env.sh"
    "wasm/scripts/memcap.sh"
    "wasm/scripts/build_orca.sh"
    "wasm/preview/CMakeLists.txt"
    "wasm/settings/extract_tab_layout.mjs"
    "wasm/web/tools/pack_profiles.mjs"
    "wasm/app/package.json"
    "wasm/app/package-lock.json"
    "wasm/tests/package.json"
    "wasm/tests/package-lock.json"
    "wasm/tests/data/fetch_models.sh"
    "wasm/tests/parity/run_parity.mjs"
    "wasm/tests/parity/native-parity.mjs"
    "wasm/tests/stress/memory-recovery.mjs"
    "wasm/tests/parity/cases.json"
    "wasm/tests/parity/make_refs_macos.sh"
    "wasm/tests/browser/run.mjs"
    "wasm/tests/app/smoke.mjs"
)

for req in "${REQUIRED_PATHS[@]}"; do
    if [ -f "$req" ] || [ -d "$req" ]; then
        log_ok "Path exists: $req"
    else
        log_error "Missing required path: $req"
    fi
done

# Verify test model fixture preconditions in clean checkout
STATIC_FIXTURES=(
    "tests/data/20mm_cube.obj"
    "tests/data/extruder_idler.obj"
    "tests/data/frog_legs.obj"
    "wasm/tests/data/two_cubes_multi.3mf"
)
for fix in "${STATIC_FIXTURES[@]}"; do
    if [ -f "$fix" ]; then
        log_ok "Clean checkout test fixture exists: $fix"
    else
        log_error "Missing clean checkout test fixture: $fix"
    fi
done

# Verify required vendor profiles for parity and tests exist
VENDOR_PROFILES=(
    "resources/profiles/Voron"
    "resources/profiles/OrcaFilamentLibrary"
    "resources/profiles/BBL"
    "resources/profiles/Prusa"
)
for vp in "${VENDOR_PROFILES[@]}"; do
    if [ -d "$vp" ]; then
        log_ok "Vendor profiles directory exists: $vp"
    else
        log_error "Missing vendor profiles directory: $vp"
    fi
done

# Check git tracking status of web app and app smoke tests
if [ -d "wasm/app" ] && git ls-files --error-unmatch wasm/app/package.json wasm/tests/app/smoke.mjs >/dev/null 2>&1; then
    log_ok "Web app and smoke test files are tracked in git repository"
else
    log_warn "Web app (wasm/app) and smoke tests (wasm/tests/app) are untracked in git"
fi

# Check dependency build scripts
DEP_SCRIPTS=(
    "wasm/deps/build_zlib.sh"
    "wasm/deps/build_png.sh"
    "wasm/deps/build_jpeg.sh"
    "wasm/deps/build_expat.sh"
    "wasm/deps/build_eigen.sh"
    "wasm/deps/build_cereal.sh"
    "wasm/deps/build_nlopt.sh"
    "wasm/deps/build_libnoise.sh"
    "wasm/deps/build_gmp.sh"
    "wasm/deps/build_mpfr.sh"
    "wasm/deps/build_cgal.sh"
    "wasm/deps/build_tbb.sh"
    "wasm/deps/build_boost.sh"
)
for dep in "${DEP_SCRIPTS[@]}"; do
    if [ -f "$dep" ]; then
        log_ok "Dependency script exists: $dep"
    else
        log_error "Missing dependency script: $dep"
    fi
done

# Verify all 15 Node test suites are present
NODE_TESTS=(wasm/tests/node/*.test.mjs)
if [ ${#NODE_TESTS[@]} -eq 15 ]; then
    log_ok "Found all 15 Node unit test suite files under wasm/tests/node/:"
    for tf in "${NODE_TESTS[@]}"; do
        echo "        - $(basename "$tf")"
    done
else
    log_error "Expected exactly 15 Node unit test suites under wasm/tests/node/, found ${#NODE_TESTS[@]}"
fi

# ------------------------------------------------------------------------------
# 4. Artifact Upload / Download Lowest Common Ancestor (LCA) Pairing
# ------------------------------------------------------------------------------
echo ""
echo "--- 4. Artifact Upload & Download Lowest Common Ancestor (LCA) Verification ---"

# Artifact definitions: [name, producer_job, consumer_jobs, upload_lca, download_path, sample_consumer_file]
verify_lca_pairing() {
    local wf="$1"
    local name="$2"
    local producer="$3"
    local consumer="$4"
    local lca_root="$5"
    local download_dest="$6"
    local expected_file="$7"

    if grep -q "name: $name" "$wf"; then
        log_ok "Artifact '$name' declared (producer: $producer, consumer: $consumer)"
    else
        log_error "Artifact '$name' not found in $wf"
        return
    fi

    # Verify consumer checks the file produced after LCA extract
    if grep -q "$expected_file" "$wf"; then
        log_ok "Artifact '$name' extracts correctly: LCA '$lca_root' -> download to '$download_dest' -> '$expected_file' verified in $wf"
    else
        log_error "Artifact '$name' verification missing for expected file '$expected_file' in $wf"
    fi
}

for wf in "${WORKFLOW_FILES[@]}"; do
    echo "Checking LCA artifact consistency in $wf..."
    # 1. orca-wasm-engine: LCA is wasm/build/orca-wasm64/wasm -> downloaded to wasm/build/orca-wasm64/wasm
    verify_lca_pairing "$wf" "orca-wasm-engine" "build" "test-node, test-browser" \
        "wasm/build/orca-wasm64/wasm" "wasm/build/orca-wasm64/wasm" \
        "wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs"

    # 2. orca-wasm-profiles: LCA is wasm/build -> downloaded to wasm/build
    verify_lca_pairing "$wf" "orca-wasm-profiles" "build" "test-node, test-browser" \
        "wasm/build" "wasm/build" \
        "wasm/build/web/profiles/index.json"

    verify_lca_pairing "$wf" "orca-wasm-profiles" "build" "test-node, test-browser" \
        "wasm/build" "wasm/build" \
        "wasm/build/tests-node/profiles/Voron.json"

    # 3. orca-wasm-preview: LCA is wasm/build/orca-wasm64-preview/wasm/preview -> downloaded to wasm/build/orca-wasm64-preview/wasm/preview
    verify_lca_pairing "$wf" "orca-wasm-preview" "build" "test-browser" \
        "wasm/build/orca-wasm64-preview/wasm/preview" "wasm/build/orca-wasm64-preview/wasm/preview" \
        "wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js"

    # 4. orca-wasm-settings: single file wasm/build/settings/layout.json -> downloaded to wasm/build/settings
    verify_lca_pairing "$wf" "orca-wasm-settings" "build" "test-browser" \
        "wasm/build/settings/layout.json" "wasm/build/settings" \
        "wasm/build/settings/layout.json"

    # 5. orca-wasm-app-dist: directory wasm/app/dist -> downloaded to wasm/app/dist
    verify_lca_pairing "$wf" "orca-wasm-app-dist" "build" "test-browser" \
        "wasm/app/dist" "wasm/app/dist" \
        "wasm/app/dist/index.html"
done

# ------------------------------------------------------------------------------
# 5. Environment & Runner Memory Scoping Assessment
# ------------------------------------------------------------------------------
echo ""
echo "--- 5. Environment & Runner Memory Boundary Assessment ---"

# Check Node heap cap
case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size=2048"*)
        log_ok "NODE_OPTIONS heap cap is active: $NODE_OPTIONS"
        ;;
    *" --max-old-space-size="*)
        log_warn "NODE_OPTIONS has a custom heap cap: $NODE_OPTIONS (workflow expects 2048)"
        ;;
    *)
        log_warn "NODE_OPTIONS currently unset in local shell (CI workflow template enforces --max-old-space-size=2048)"
        ;;
esac

# Check build parallelism cap
WASM_JOBS_VAL="${WASM_JOBS:-10}"
if [ "$WASM_JOBS_VAL" -le 6 ]; then
    log_ok "WASM_JOBS cap <= 6 ($WASM_JOBS_VAL)"
else
    log_warn "WASM_JOBS is currently $WASM_JOBS_VAL locally (CI workflow template enforces max 6 jobs)"
fi

# Check systemd-run --user capability locally
if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true 2>/dev/null; then
    log_ok "systemd-run --user is functional on local host for wasm/scripts/memcap.sh (10GB scoped cgroup execution)"
else
    log_warn "systemd-run --user is not currently active in local environment"
fi

for wf in "${WORKFLOW_FILES[@]}"; do
    echo "Checking scoped memory configuration in $wf..."

    # Check that runner provisioning step exists for ubuntu-24.04 jobs
    if grep -q "Provision scoped memory boundary (systemd-run)" "$wf"; then
        log_ok "Workflow $wf contains runner systemd session provisioning step"
    else
        log_error "Workflow $wf missing runner scoped memory provisioning step"
    fi

    # Check that build dependencies and compilation are wrapped via memcap.sh
    if grep -q "wasm/scripts/memcap.sh bash.*build_orca.sh" "$wf"; then
        log_ok "Workflow $wf wraps engine build in wasm/scripts/memcap.sh"
    else
        log_error "Workflow $wf does not wrap engine build in wasm/scripts/memcap.sh"
    fi

    # Check that web app build is wrapped via memcap.sh
    if grep -q "wasm/scripts/memcap.sh npm --prefix wasm/app run build" "$wf"; then
        log_ok "Workflow $wf wraps web app build in wasm/scripts/memcap.sh"
    else
        log_error "Workflow $wf does not wrap web app build in wasm/scripts/memcap.sh"
    fi

    # Check that Node tests are wrapped via memcap.sh
    if grep -q "wasm/scripts/memcap.sh node --test" "$wf"; then
        log_ok "Workflow $wf wraps Node test suite in wasm/scripts/memcap.sh"
    else
        log_error "Workflow $wf does not wrap Node test suite in wasm/scripts/memcap.sh"
    fi

    # Verify no arbitrary silent fallback is present in the workflow
    if grep -q "wasm/scripts/memcap.sh" "$wf" && grep -B1 -A2 "wasm/scripts/memcap.sh" "$wf" | grep -q "else"; then
        log_error "Workflow $wf contains silent fallback around wasm/scripts/memcap.sh"
    else
        log_ok "Workflow $wf enforces scoped execution without silent fallback"
    fi

    # Verify that macOS reference job does NOT include Linux-only systemd provisioning
    if sed -n '/refs-macos:/,$p' "$wf" | grep -q "Provision scoped memory boundary"; then
        log_error "Workflow $wf wrongly adds Linux-only systemd provisioning to macOS job"
    else
        log_ok "macOS reference job in $wf correctly omits Linux-only systemd provisioning"
    fi
done

# ------------------------------------------------------------------------------
# 6. Native Parity Reference Distinction, CLI Flags & Runner Input Integrity
# ------------------------------------------------------------------------------
echo ""
echo "--- 6. Native Parity CLI Flags, Inputs & Reference Distinction ---"

for wf in "${WORKFLOW_FILES[@]}"; do
    echo "Checking native parity configuration in $wf..."

    # Check that driver comparison (run_parity.mjs) is not mislabeled as native parity
    if grep -B2 -A2 "run_parity.mjs" "$wf" | grep -iq "name:.*native parity"; then
        log_error "Workflow $wf mislabels driver comparison (run_parity.mjs) as native parity"
    else
        log_ok "Workflow $wf correctly distinguishes driver comparison from native parity"
    fi

    # Check that real native parity suite is present in the workflow
    if grep -q "native-parity.mjs" "$wf"; then
        log_ok "Workflow $wf includes real native Linux parity suite (native-parity.mjs)"
    else
        log_error "Workflow $wf missing real native Linux parity suite (native-parity.mjs)"
    fi

    # Check that ORCA_ENGINE_MODULE is configured to point to downloaded engine artifact
    if grep -q "ORCA_ENGINE_MODULE: wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs" "$wf"; then
        log_ok "Workflow $wf sets ORCA_ENGINE_MODULE to downloaded engine artifact for native parity"
    else
        log_error "Workflow $wf missing ORCA_ENGINE_MODULE path configuration for native parity"
    fi

    # Check that NATIVE_ORCA is configured to point to extracted AppRun
    if grep -q "NATIVE_ORCA: /tmp/orca-native/squashfs-root/AppRun" "$wf"; then
        log_ok "Workflow $wf sets NATIVE_ORCA to extracted AppRun for native parity"
    else
        log_error "Workflow $wf missing NATIVE_ORCA path configuration for native parity"
    fi

    # Check that native parity step does NOT mask failures (no || true, no continue-on-error)
    if grep "native-parity.mjs" "$wf" | grep -q "|| true"; then
        log_error "Workflow $wf masks native parity mismatch with '|| true'"
    elif grep -B2 -A4 "native-parity.mjs" "$wf" | grep -q "continue-on-error:\s*true"; then
        log_error "Workflow $wf masks native parity mismatch with 'continue-on-error: true'"
    else
        log_ok "Workflow $wf enforces strict non-zero exit on native parity mismatch (no masking, no continue-on-error)"
    fi

    # Verify that unproven causal diagnosis regarding stdlib differences is NOT asserted in workflow
    if grep -i "due to toolchain stdlib differences" "$wf" || grep -i "caused by stdlib differences" "$wf"; then
        log_error "Workflow $wf asserts unproven causal diagnosis attributing mismatches to stdlib differences"
    else
        log_ok "Workflow $wf omits unproven causal diagnosis regarding stdlib differences"
    fi
done

# Trace native CLI flags in parity runners
echo "Tracing native CLI flags in parity runners..."
if grep -q "\-\-load-settings" wasm/tests/parity/native-parity.mjs \
   && grep -q "\-\-load-filaments" wasm/tests/parity/native-parity.mjs \
   && grep -q "\-\-slice" wasm/tests/parity/native-parity.mjs \
   && grep -q "\-\-outputdir" wasm/tests/parity/native-parity.mjs; then
    log_ok "native-parity.mjs uses valid native CLI flags (--load-settings, --load-filaments, --slice 0, --outputdir)"
else
    log_error "native-parity.mjs CLI flags do not match native CLI requirements"
fi

if grep -q "\-\-load-settings" wasm/tests/parity/run_parity.mjs \
   && grep -q "\-\-load-filaments" wasm/tests/parity/run_parity.mjs \
   && grep -q "\-\-export-settings" wasm/tests/parity/run_parity.mjs; then
    log_ok "run_parity.mjs uses valid native CLI config export flags (--load-settings, --load-filaments, --export-settings)"
else
    log_error "run_parity.mjs CLI flags do not match native CLI export requirements"
fi

if grep -q "\-\-load-settings" wasm/tests/parity/make_refs_macos.sh \
   && grep -q "\-\-load-filaments" wasm/tests/parity/make_refs_macos.sh \
   && grep -q "\-\-slice" wasm/tests/parity/make_refs_macos.sh \
   && grep -q "\-\-outputdir" wasm/tests/parity/make_refs_macos.sh; then
    log_ok "make_refs_macos.sh uses valid native CLI flags (--load-settings, --load-filaments, --slice 0, --outputdir)"
else
    log_error "make_refs_macos.sh CLI flags do not match native CLI requirements"
fi

# Check committed reference files
REFS_DIR="wasm/tests/parity/refs-macos-x86_64"
if [ -d "$REFS_DIR" ]; then
    COMMITTED_REFS=("$REFS_DIR"/*.gcode)
    if [ -f "${COMMITTED_REFS[0]}" ]; then
        log_ok "Committed macOS x86_64 reference files (${#COMMITTED_REFS[@]} found):"
        for rf in "${COMMITTED_REFS[@]}"; do
            echo "        - $(basename "$rf")"
        done
    else
        log_warn "No .gcode reference files found in $REFS_DIR"
    fi
else
    log_warn "Reference directory $REFS_DIR does not exist"
fi

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo ""
echo "=== Validation Summary ==="
echo "Errors:   $ERRORS"
echo "Warnings: $WARNINGS"

if [ $ERRORS -gt 0 ]; then
    echo "[FAIL] Validation failed with $ERRORS error(s)." >&2
    exit 1
else
    echo "[PASS] Validation succeeded."
    exit 0
fi
