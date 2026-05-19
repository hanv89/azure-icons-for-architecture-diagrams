#!/usr/bin/env bash
# Detects drift between `fixture/skill-md-only` and `main`.
#
# The fixture branch is a stripped-down view of main used by the end-to-end
# install smoke test in `scripts/smoke_cli.sh`:
#   - `dist/Azure/Compute/AzureVirtualMachine.png` is removed (the "canary"
#     icon that the install test expects to 404, validating the install
#     adapter handles missing-file fall-through gracefully).
#   - `packages/` is excluded (the fixture is the skill bundle only — no CLI
#     source, no tests).
# Every other file MUST match main exactly. If drift is detected, the fixture
# is stale and needs rebuilding (see the rebuild procedure below).
#
# Run locally:
#   git fetch origin fixture/skill-md-only:fixture/skill-md-only
#   bash scripts/test_fixture_drift.sh
#
# Exit codes:
#   0 — no drift (fixture in sync modulo the canary + packages exclusion).
#   1 — drift detected; fixture needs rebuilding.
#   2 — environment problem (fixture branch missing, refs unavailable).

set -uo pipefail
export LC_ALL=C

# Ensure both refs are reachable locally.
if ! git rev-parse --verify origin/main >/dev/null 2>&1 && ! git rev-parse --verify main >/dev/null 2>&1; then
  echo "FAIL: neither main nor origin/main is reachable; cannot compare" >&2
  exit 2
fi
MAIN_REF="$(git rev-parse --verify main 2>/dev/null || git rev-parse --verify origin/main 2>/dev/null)"

if ! git rev-parse --verify fixture/skill-md-only >/dev/null 2>&1; then
  echo "FAIL: fixture/skill-md-only not reachable locally" >&2
  echo "Run: git fetch origin fixture/skill-md-only:fixture/skill-md-only" >&2
  exit 2
fi
FIXTURE_REF="$(git rev-parse --verify fixture/skill-md-only)"

echo "Comparing fixture/skill-md-only (${FIXTURE_REF:0:8}) against main (${MAIN_REF:0:8})..."

# Compute the diff between fixture and main, excluding the two intentional
# deletions (canary + packages).
DRIFT=$(git diff --name-status "${MAIN_REF}" "${FIXTURE_REF}" -- \
  ':!dist/Azure/Compute/AzureVirtualMachine.png' \
  ':!packages/' 2>/dev/null || true)

if [ -n "${DRIFT}" ]; then
  echo "FAIL: fixture/skill-md-only has drifted from main:"
  echo "${DRIFT}"
  echo ""
  echo "Rebuild the fixture:"
  echo "  git checkout -b fixture/skill-md-only-new main"
  echo "  git rm dist/Azure/Compute/AzureVirtualMachine.png"
  echo "  git rm -r packages/"
  echo "  git commit -m 'fixture: skill-md-only — rebuild against main'"
  echo "  git push origin fixture/skill-md-only-new:fixture/skill-md-only --force-with-lease"
  exit 1
fi

echo "PASS: fixture/skill-md-only is in sync with main (modulo canary + packages exclusion)."
exit 0
