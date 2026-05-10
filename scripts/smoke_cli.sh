#!/usr/bin/env bash
# Verify the @hanv89/azure-arch-skill CLI builds and the documented
# exit-code contract is intact. Re-runnable any time; no side effects
# beyond a transient packages/cli/dist/ build artifact (gitignored).
#
# Intended to be invoked manually before commits that touch
# packages/cli/, and as a release gate by future CI workflows.
#
# Exit codes:
#   0 — build succeeded and all probed subcommand paths exited as
#       documented.
#   1 — at least one assertion failed.
#   2 — environment problem (node, npm, working tree, or registry
#       reachability missing). Network failure during npm ci is an
#       environment issue, not a logic failure.
#
# no -e: per-assertion accounting must complete so the user sees every
# failure in one run, not just the first.
set -uo pipefail
export LC_ALL=C

command -v node >/dev/null 2>&1 || { echo "ERROR: node not installed"; exit 2; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm not installed";  exit 2; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="${REPO_ROOT}/packages/cli"
[ -d "${CLI_DIR}" ] || { echo "ERROR: ${CLI_DIR} missing"; exit 2; }
[ -f "${CLI_DIR}/package.json" ]      || { echo "ERROR: ${CLI_DIR}/package.json missing";      exit 2; }
[ -f "${CLI_DIR}/package-lock.json" ] || { echo "ERROR: ${CLI_DIR}/package-lock.json missing"; exit 2; }

cd "${CLI_DIR}"

PASSED=0
FAILED=0

assert_exit() {
  local label="$1"; local expected="$2"; shift 2
  local err
  err="$("$@" 2>&1 >/dev/null)"
  local actual=$?
  if [ "${actual}" -eq "${expected}" ]; then
    echo "PASS ${label} (exit ${actual})"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL ${label} (expected exit ${expected}, got ${actual})"
    if [ -n "${err}" ]; then
      echo "  stderr: ${err}" | head -5
    fi
    FAILED=$((FAILED + 1))
  fi
}

# Step 1 — deterministic dependency install. npm ci fails loudly if
# node_modules is out of sync with package-lock.json, never mutates the
# lockfile, and exits non-zero on registry unreachability — exactly the
# semantics this smoke wants. Network failure → exit 2 ("env"), not 1.
echo "INFO  npm ci..."
if ! npm ci --silent; then
  echo "FAIL  npm ci (registry unreachable, lockfile out of sync, or proxy issue) — treated as env error"
  exit 2
fi

# Step 2 — build.
echo "INFO  building..."
npm run build --silent || { echo "FAIL  npm run build"; exit 1; }
[ -s dist/index.js ] || { echo "FAIL  dist/index.js missing after build"; exit 1; }
echo "PASS  build"

# Step 3 — exit-code contracts.
assert_exit "list   exits 0"            0 node dist/index.js list
assert_exit "no-arg exits 0 (USAGE)"    0 node dist/index.js
assert_exit "bogus  exits 1"            1 node dist/index.js bogus
assert_exit "--help exits 0"            0 node dist/index.js --help
assert_exit "version prints exits 0"    0 node dist/index.js --version
assert_exit "install --help exits 0"    0 node dist/index.js install --help

echo
echo "Summary: ${PASSED} passed, ${FAILED} failed."
[ "${FAILED}" -eq 0 ] || exit 1
