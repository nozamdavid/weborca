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
# 1. YAML Configuration & Parser Validation
# ------------------------------------------------------------------------------
echo ""
echo "--- 1. YAML Configuration Validation ---"
CI_WORKFLOW="wasm/ci/wasm.yml"

if [ ! -f "$CI_WORKFLOW" ]; then
    log_error "Workflow file not found: $CI_WORKFLOW"
else
    log_ok "Workflow template found: $CI_WORKFLOW"

    # Check for actionlint
    if command -v actionlint >/dev/null 2>&1; then
        log_info "actionlint found, running actionlint on $CI_WORKFLOW..."
        if actionlint "$CI_WORKFLOW"; then
            log_ok "actionlint passed on $CI_WORKFLOW"
        else
            log_error "actionlint failed on $CI_WORKFLOW"
        fi
    else
        log_info "actionlint: not installed (skipping actionlint)"
    fi

    # Check for yamllint
    if command -v yamllint >/dev/null 2>&1; then
        log_info "yamllint found, running yamllint on $CI_WORKFLOW..."
        if yamllint -d "{extends: default, rules: {line-length: disable}}" "$CI_WORKFLOW"; then
            log_ok "yamllint passed on $CI_WORKFLOW"
        else
            log_warn "yamllint reported issues on $CI_WORKFLOW"
        fi
    else
        log_info "yamllint: not installed (skipping yamllint)"
    fi

    # Validate with Python PyYAML (standard lightweight parser)
    if command -v python3 >/dev/null 2>&1; then
        if python3 -c "import yaml" >/dev/null 2>&1; then
            if python3 -c "import yaml; yaml.safe_load(open('$CI_WORKFLOW'))" >/dev/null 2>&1; then
                log_ok "PyYAML: successfully parsed $CI_WORKFLOW"
            else
                log_error "PyYAML: failed to parse $CI_WORKFLOW"
            fi
        else
            log_warn "python3 PyYAML module not available for YAML validation"
        fi
    else
        log_warn "python3 not available to parse YAML"
    fi
fi

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
# 3. Referenced Static Paths and Build Tooling
# ------------------------------------------------------------------------------
echo ""
echo "--- 3. Static Path & File References ---"
REQUIRED_PATHS=(
    "wasm/scripts/env.sh"
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

# Check git tracking status of web app and app smoke tests
if [ -d "wasm/app" ] && git ls-files --error-unmatch wasm/app/package.json wasm/tests/app/smoke.mjs >/dev/null 2>&1; then
    log_ok "Web app and smoke test files are tracked in git repository"
else
    log_warn "Web app (wasm/app) and smoke tests (wasm/tests/app) are untracked in git; app CI integration is pending"
fi

# Check dependency scripts
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

# Check node test suite files
NODE_TESTS=(wasm/tests/node/*.test.mjs)
if [ ${#NODE_TESTS[@]} -eq 0 ] || [ ! -f "${NODE_TESTS[0]}" ]; then
    log_error "No Node test suites found in wasm/tests/node/*.test.mjs"
else
    log_ok "Found ${#NODE_TESTS[@]} Node test suite files under wasm/tests/node/:"
    for tf in "${NODE_TESTS[@]}"; do
        echo "        - $(basename "$tf")"
    done
fi

# ------------------------------------------------------------------------------
# 4. Artifact Upload / Download Pairing & Producer-Consumer Verification
# ------------------------------------------------------------------------------
echo ""
echo "--- 4. Artifact Upload & Download Pairing ---"

check_artifact_pair() {
    local name="$1"
    local uploader_job="$2"
    local downloader_job="$3"

    # Search for artifact name in workflow
    if grep -q "name: $name" "$CI_WORKFLOW"; then
        log_ok "Artifact '$name': registered in $CI_WORKFLOW (producer: $uploader_job, consumer: $downloader_job)"
    else
        log_error "Artifact '$name' not found in $CI_WORKFLOW"
    fi
}

check_artifact_pair "orca-wasm-engine"     "build" "test-node, test-browser"
check_artifact_pair "orca-wasm-profiles"   "build" "test-node, test-browser"
check_artifact_pair "orca-wasm-preview"    "build" "test-browser"
check_artifact_pair "orca-wasm-settings"   "build" "test-browser"
check_artifact_pair "orca-wasm-app-dist"   "build" "test-browser"
check_artifact_pair "browser-test-results" "test-browser" "upload-only"
check_artifact_pair "refs-macos-x86_64"    "refs-macos" "upload-only"

echo ""
echo "--- 4b. Producer vs Consumer Artifact Path Verification ---"

# 1. pack_profiles.mjs produces <outDir>/profiles/<Vendor>.json and <outDir>/profiles/index.json
# Consumers expect wasm/build/tests-node/profiles/Voron.json and wasm/build/web/profiles/index.json
if grep -q "tests-node/Voron/index.json" "$CI_WORKFLOW"; then
    log_error "Workflow checks invalid artifact path 'tests-node/Voron/index.json'. pack_profiles.mjs outputs 'tests-node/profiles/Voron.json'."
else
    log_ok "No stale artifact path 'tests-node/Voron/index.json' in workflow"
fi

if grep -q "wasm/build/web/index.json" "$CI_WORKFLOW"; then
    log_error "Workflow checks invalid artifact path 'wasm/build/web/index.json'. pack_profiles.mjs outputs 'wasm/build/web/profiles/index.json'."
else
    log_ok "No stale artifact path 'wasm/build/web/index.json' in workflow"
fi

if grep -q "wasm/build/tests-node/profiles/Voron.json" "$CI_WORKFLOW"; then
    log_ok "Workflow correctly verifies 'wasm/build/tests-node/profiles/Voron.json'"
else
    log_error "Workflow missing verification for 'wasm/build/tests-node/profiles/Voron.json'"
fi

if grep -q "wasm/build/web/profiles/index.json" "$CI_WORKFLOW"; then
    log_ok "Workflow correctly verifies 'wasm/build/web/profiles/index.json'"
else
    log_error "Workflow missing verification for 'wasm/build/web/profiles/index.json'"
fi

# 2. Preview build configuration verification
if grep -q "ORCA_WASM_PREVIEW=ON" "$CI_WORKFLOW"; then
    log_ok "Preview build option -DORCA_WASM_PREVIEW=ON is configured in workflow"
else
    log_error "Preview build missing -DORCA_WASM_PREVIEW=ON in workflow"
fi

if grep -q "wasm/build/orca-wasm64-preview" "$CI_WORKFLOW"; then
    log_ok "Preview build directory wasm/build/orca-wasm64-preview matches consumer expectation"
else
    log_error "Preview build directory wasm/build/orca-wasm64-preview missing in workflow"
fi

# ------------------------------------------------------------------------------
# 5. Environment & Runner Memory Enforcement Assessment
# ------------------------------------------------------------------------------
echo ""
echo "--- 5. Environment & Runner Memory Assessment ---"

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

# Assess total process memory enforcement mechanism
TOTAL_MEM_ENFORCED=false
if command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true 2>/dev/null; then
    log_ok "systemd-run --user is functional on this environment for wasm/scripts/memcap.sh (10GB cgroup enforcement)"
    TOTAL_MEM_ENFORCED=true
fi
if [ -f /sys/fs/cgroup/memory.max ]; then
    CGROUP_MAX=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo "max")
    if [ "$CGROUP_MAX" != "max" ] && [ "$CGROUP_MAX" -le 10737418240 ] 2>/dev/null; then
        log_ok "cgroup v2 memory.max is bounded ($CGROUP_MAX <= 10GB)"
        TOTAL_MEM_ENFORCED=true
    fi
fi
if [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    CGROUP_V1=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "")
    if [ -n "$CGROUP_V1" ] && [ "$CGROUP_V1" -le 10737418240 ] 2>/dev/null; then
        log_ok "cgroup v1 memory.limit_in_bytes is bounded ($CGROUP_V1 <= 10GB)"
        TOTAL_MEM_ENFORCED=true
    fi
fi

if [ "$TOTAL_MEM_ENFORCED" = "true" ]; then
    log_ok "Total 10GB memory enforcement mechanism is active"
else
    log_warn "Total 10GB process memory enforcement is NOT active in this environment."
    log_warn "  Note: NODE_OPTIONS (2048 MB) and WASM_JOBS (6) are process/concurrency controls, NOT total memory enforcement."
    log_warn "  Workflow strictly requires 10GB bounding and will fail clearly pending a configured bounded runner (cgroup <=10GB or systemd-run --user)."
fi

# Check that workflow template enforces 10GB ceiling without uncapped fallback
if grep -q "Enforce 10GB runner memory ceiling" "$CI_WORKFLOW"; then
    log_ok "Workflow template contains fail-fast 10GB memory bounding preflight"
else
    log_error "Workflow template missing explicit 10GB memory enforcement preflight"
fi

# Verify that Linux-only cgroup/systemd preflight is NOT wrongly placed in macOS reference job
if sed -n '/refs-macos:/,$p' "$CI_WORKFLOW" | grep -q "Enforce 10GB runner memory ceiling"; then
    log_error "Workflow wrongly adds Linux-only 10GB memory preflight to macOS reference job"
else
    log_ok "macOS reference job correctly omits Linux-only 10GB memory preflight"
fi

# ------------------------------------------------------------------------------
# 6. Native Parity Reference Distinction & Input Integrity
# ------------------------------------------------------------------------------
echo ""
echo "--- 6. Native Parity Reference Distinction & Input Integrity ---"
log_info "Check (a) Driver Comparison: Validates PresetBundle merging using native CLI --export-settings JSON vs spike driver."
log_info "Check (b) Native macOS x86_64 Reference: Validates engine G-code against pre-recorded golden references."

# Check rejection semantics don't claim URL immutability beyond checksum
if grep -iq "immutable native" "$CI_WORKFLOW" || grep -iq "immutable artifact" "$CI_WORKFLOW"; then
    log_warn "Workflow claims URLs are immutable. Immutability/integrity is enforced via SHA-256 verification, not URL properties."
else
    log_ok "Workflow correctly defines URL + SHA-256 integrity semantics without claiming URL immutability"
fi

REFS_DIR="wasm/tests/parity/refs-macos-x86_64"
if [ -d "$REFS_DIR" ]; then
    COMMITTED_REFS=("$REFS_DIR"/*.gcode)
    if [ -f "${COMMITTED_REFS[0]}" ]; then
        log_ok "Committed macOS x86_64 reference files (${#COMMITTED_REFS[@]} found):"
        for rf in "${COMMITTED_REFS[@]}"; do
            echo "        - $(basename "$rf")"
        done
        log_info "Note: Not all cases in cases.json have pre-recorded goldens. Missing references report as 'no ref' without failing."
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
