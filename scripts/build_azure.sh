#!/usr/bin/env bash
# Reproducible Azure icon build (Variant B — Azure-PlantUML upstream).
# Idempotent: safe to re-run.
#
# Exit codes:
#   0 — success (PNG set refreshed, UPSTREAM-SHA.txt updated).
#   1 — build failure or refused content drop (use --allow-removals to override).
#   2 — environment problem (git missing, upstream unreachable, etc.).
#
# Hardenings landed 2026-05-11:
#   (a) Upstream branch auto-detected via `git ls-remote --symref HEAD` so the
#       script keeps working if the upstream renames master→main. Allow
#       UPSTREAM_BRANCH env override.
#   (b) Relative-drop threshold: refuse to proceed if the new PNG count is
#       >10% smaller than what's already in dist/Azure unless --allow-removals.
#   (c) --allow-removals CLI flag (or ALLOW_REMOVALS=1 env) bypasses the gate.
#   (d) LC_ALL=C export at script top for deterministic sort + find order.
#   (e) UPSTREAM-SHA.txt persisted under dist/Azure/ for Phase 1.7 release
#       notes traceability.
#   (f) Structured 0/1/2 exit codes matching smoke_urls.sh / smoke_e2e.sh.
#   (g) Scoped find -delete (`-name '*.png' -delete`) preserves USAGE-RULES.txt
#       + .gitkeep + future non-PNG artifacts.

set -euo pipefail
export LC_ALL=C

# ---- CLI arg parse ----
ALLOW_REMOVALS="${ALLOW_REMOVALS:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-removals) ALLOW_REMOVALS=1; shift ;;
    -h|--help)
      grep -E '^# (Exit|  |Reproducible|Idempotent|Hardenings)' "$0" >&2
      exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/source/Azure-PlantUML"
DIST_DIR="${REPO_ROOT}/dist/Azure"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/plantuml-stdlib/Azure-PlantUML.git}"

# ---- Upstream branch auto-detect (item a) ----
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-}"
if [ -z "${UPSTREAM_BRANCH}" ]; then
  UPSTREAM_BRANCH=$(git ls-remote --symref "${UPSTREAM_REPO}" HEAD 2>/dev/null \
                    | head -1 | awk '/^ref:/ {print $2}' | sed 's|refs/heads/||')
fi
if [ -z "${UPSTREAM_BRANCH}" ]; then
  echo "ERROR: cannot detect upstream default branch from ${UPSTREAM_REPO}" >&2
  exit 2
fi
echo "Upstream: ${UPSTREAM_REPO} branch=${UPSTREAM_BRANCH}"

# ---- 1. Ensure upstream cloned (shallow, detected branch) ----
if [ ! -d "${SOURCE_DIR}/.git" ]; then
  echo "Cloning Azure-PlantUML upstream..."
  mkdir -p "${REPO_ROOT}/source"
  git clone --depth 1 --branch "${UPSTREAM_BRANCH}" "${UPSTREAM_REPO}" "${SOURCE_DIR}" || {
    echo "ERROR: clone failed" >&2; exit 2
  }
else
  echo "Refreshing existing clone..."
  git -C "${SOURCE_DIR}" fetch --depth 1 origin "${UPSTREAM_BRANCH}" || {
    echo "ERROR: fetch failed" >&2; exit 2
  }
  git -C "${SOURCE_DIR}" reset --hard "origin/${UPSTREAM_BRANCH}"
fi

UPSTREAM_SHA="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
echo "Upstream SHA: ${UPSTREAM_SHA}"

# ---- 2. Drop-threshold gate (items b + c) ----
mkdir -p "${DIST_DIR}"
OLD_COUNT="$(find "${DIST_DIR}" -name '*.png' 2>/dev/null | wc -l)"
NEW_COUNT="$(find "${SOURCE_DIR}/dist" -name '*.png' 2>/dev/null | wc -l)"
echo "Counts: old=${OLD_COUNT} upstream=${NEW_COUNT}"

if [ "${OLD_COUNT}" -gt 0 ]; then
  DROP=$(( OLD_COUNT - NEW_COUNT ))
  THRESHOLD=$(( OLD_COUNT / 10 ))   # 10% relative drop
  if [ "${DROP}" -gt "${THRESHOLD}" ] && [ "${ALLOW_REMOVALS}" -ne 1 ]; then
    echo "ERROR: icon count would drop >10% (old=${OLD_COUNT} new=${NEW_COUNT}, drop=${DROP})." >&2
    echo "Pass --allow-removals or set ALLOW_REMOVALS=1 to override." >&2
    exit 1
  fi
fi

# ---- 3. Scoped clean (item g) — preserve USAGE-RULES.txt, .gitkeep, etc. ----
echo "Cleaning ${DIST_DIR}/**/*.png..."
find "${DIST_DIR}" -name '*.png' -delete

# ---- 4. Copy *.png only, preserving category structure ----
echo "Copying PNGs..."
rsync -a \
  --include='*/' \
  --include='*.png' \
  --exclude='*' \
  "${SOURCE_DIR}/dist/" "${DIST_DIR}/"

# ---- 5. Drop empty directories left by the include/exclude filter ----
find "${DIST_DIR}" -type d -empty -delete

# ---- 6. Persist UPSTREAM-SHA.txt (item e) ----
echo "${UPSTREAM_SHA}" > "${DIST_DIR}/UPSTREAM-SHA.txt"

# ---- 7. Verify ----
COUNT="$(find "${DIST_DIR}" -name '*.png' | wc -l)"
echo "PNG count: ${COUNT}"
if [ "${COUNT}" -lt 500 ]; then
  echo "ERROR: count < 500, aborting" >&2
  exit 1
fi

# ---- 8. Sample report ----
echo "Sample paths:"
find "${DIST_DIR}" -name '*.png' | sort | sed -n '1p;100p;$p'

echo "OK · upstream=${UPSTREAM_SHA} branch=${UPSTREAM_BRANCH} count=${COUNT}"
