#!/usr/bin/env bash
# Reproducible Microsoft Fabric icon build (Variant B — @fabric-msft/svg-icons
# npm upstream, Microsoft first-party MIT per D-021).
# Idempotent: safe to re-run.
#
# Exit codes:
#   0 — success (PNG set refreshed, UPSTREAM-VERSION.txt updated).
#   1 — build failure or refused content drop (use --allow-removals to override).
#   2 — environment problem (rsvg-convert / npm / network missing, etc.).
#
# Phase 1.1 inherits D-008 hardenings from build_azure.sh (post-Phase-1.0):
#   (a) Upstream version auto-detected via `npm view @fabric-msft/svg-icons version`.
#       Allow FABRIC_VERSION env override.
#   (b) Relative-drop threshold: refuse if (OLD - NEW) > OLD * 10% unless
#       --allow-removals.
#   (c) --allow-removals CLI flag (or ALLOW_REMOVALS=1 env) bypasses the gate.
#   (d) LC_ALL=C export at script top for deterministic sort + find order.
#   (e) UPSTREAM-VERSION.txt persisted under dist/Fabric/ for release-notes traceability.
#       Format: single line `@fabric-msft/svg-icons@<semver>`.
#   (f) Structured 0/1/2 exit codes matching smoke_urls.sh / smoke_e2e.sh.
#   (g) Scoped find -delete ('-name *.png -delete') preserves USAGE-RULES.txt.
#
# Scope filter (post-v0.2.0 widening): convert ALL size-40 Fabric service
# icons from the 1598-SVG upstream package. Three patterns at size 40:
#   *_40_item.svg     — primary item icons (Lakehouse, Pipeline, Notebook, ...)
#   *_40_non-item.svg — secondary forms (Folder, GroupWorkspace, MyWorkspace,
#                       AddPipeline, ImportNotebook, Sample, EventHouse-alt)
#   *_40.svg          — special-form services with no _item suffix
#                       (graph_model, graph_queryset)
# Plus mirrored_catalog: upstream has no size-40 variant at all, so we
# downscale `mirrored_catalog_48_item.svg` to 40x40 via rsvg-convert.
# Total: 65 icons at @fabric-msft/svg-icons@7.0.1.
# The bulk of the 1598-SVG upstream (565 _regular + 564 _filled + smaller
# sizes) is generic UI affordances, not Fabric services — out of scope.

set -euo pipefail
export LC_ALL=C

# ---- CLI arg parse ----
ALLOW_REMOVALS="${ALLOW_REMOVALS:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-removals) ALLOW_REMOVALS=1; shift ;;
    -h|--help)
      grep -E '^# (Exit|  |Reproducible|Idempotent|Phase|Scope)' "$0" >&2
      exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/source/fabric-svg-icons"
DIST_DIR="${REPO_ROOT}/dist/Fabric/png"
NPM_PKG="@fabric-msft/svg-icons"

# ---- Tooling probe ----
command -v rsvg-convert >/dev/null 2>&1 || { echo "ERROR: rsvg-convert not installed (apt install librsvg2-bin)" >&2; exit 2; }
command -v npm          >/dev/null 2>&1 || { echo "ERROR: npm not installed" >&2; exit 2; }

# ---- Upstream version auto-detect (item a) ----
FABRIC_VERSION="${FABRIC_VERSION:-}"
if [ -z "${FABRIC_VERSION}" ]; then
  FABRIC_VERSION=$(npm view "${NPM_PKG}" version 2>/dev/null | tail -1)
fi
if [ -z "${FABRIC_VERSION}" ]; then
  echo "ERROR: cannot detect ${NPM_PKG} version from npm registry" >&2
  exit 2
fi
echo "Upstream: ${NPM_PKG}@${FABRIC_VERSION}"

# ---- License re-verification (D-021 per-release clause) ----
LICENSE=$(npm view "${NPM_PKG}@${FABRIC_VERSION}" license 2>/dev/null | tail -1)
if [ "${LICENSE}" != "MIT" ]; then
  echo "ERROR: ${NPM_PKG}@${FABRIC_VERSION} license is '${LICENSE}', expected MIT (D-021 gate)" >&2
  exit 2
fi
echo "License: ${LICENSE} (D-021 gate satisfied)"

# ---- 1. npm install into isolated source dir ----
mkdir -p "${SOURCE_DIR}"
echo "Installing ${NPM_PKG}@${FABRIC_VERSION} into ${SOURCE_DIR}..."
( cd "${SOURCE_DIR}" && npm install --no-package-lock --no-save --silent "${NPM_PKG}@${FABRIC_VERSION}" ) || {
  echo "ERROR: npm install failed" >&2; exit 2;
}
SVG_DIR="${SOURCE_DIR}/node_modules/${NPM_PKG}/dist/svg"
[ -d "${SVG_DIR}" ] || { echo "ERROR: expected SVG dir not found at ${SVG_DIR}" >&2; exit 2; }

# ---- 2. Drop-threshold gate (items b + c) ----
mkdir -p "${DIST_DIR}"
OLD_COUNT="$(find "${DIST_DIR}" -name '*.png' 2>/dev/null | wc -l)"
# Scope filter: all size-40 Fabric service icon variants + mirrored_catalog
# (no size-40 upstream; downscale from 48).
SVG_LIST=$(find "${SVG_DIR}" \
  \( -name '*_40_item.svg' -o -name '*_40_non-item.svg' -o -name '*_40.svg' \) \
  | sort)
MIRRORED_SRC="${SVG_DIR}/mirrored_catalog_48_item.svg"
if [ -f "${MIRRORED_SRC}" ]; then
  SVG_LIST="${SVG_LIST}
${MIRRORED_SRC}"
fi
NEW_COUNT=$(echo "${SVG_LIST}" | grep -c '\.svg$' || true)
echo "Counts: old=${OLD_COUNT} new=${NEW_COUNT}"

if [ "${OLD_COUNT}" -gt 0 ]; then
  DROP=$(( OLD_COUNT - NEW_COUNT ))
  THRESHOLD=$(( OLD_COUNT / 10 ))   # 10% relative drop
  if [ "${DROP}" -gt "${THRESHOLD}" ] && [ "${ALLOW_REMOVALS}" -ne 1 ]; then
    echo "ERROR: icon count would drop >10% (old=${OLD_COUNT} new=${NEW_COUNT}, drop=${DROP})." >&2
    echo "Pass --allow-removals or set ALLOW_REMOVALS=1 to override." >&2
    exit 1
  fi
fi

# ---- 3. Scoped clean (item g) ----
echo "Cleaning ${DIST_DIR}/*.png..."
find "${DIST_DIR}" -name '*.png' -delete

# ---- 4. SVG -> PNG via rsvg-convert (40x40 to match `_40_item` size class) ----
echo "Converting ${NEW_COUNT} SVGs to PNG..."
CONVERTED=0
while IFS= read -r SVG; do
  [ -n "${SVG}" ] || continue
  NAME=$(basename "${SVG}" .svg)
  # Special case: mirrored_catalog upstream has no _40 size, downscale from 48.
  # Rename output to _40_item so users find it under the standard naming.
  if [ "${NAME}" = "mirrored_catalog_48_item" ]; then
    NAME="mirrored_catalog_40_item"
  fi
  rsvg-convert -w 40 -h 40 -o "${DIST_DIR}/${NAME}.png" "${SVG}" || {
    echo "ERROR: rsvg-convert failed on ${SVG}" >&2; exit 1;
  }
  CONVERTED=$(( CONVERTED + 1 ))
done <<< "${SVG_LIST}"
echo "Converted: ${CONVERTED}"

# ---- 5. Persist UPSTREAM-VERSION.txt (item e) ----
echo "${NPM_PKG}@${FABRIC_VERSION}" > "${REPO_ROOT}/dist/Fabric/UPSTREAM-VERSION.txt"

# ---- 6. Verify ----
COUNT="$(find "${DIST_DIR}" -name '*.png' | wc -l)"
echo "PNG count: ${COUNT}"
if [ "${COUNT}" -lt 30 ]; then
  echo "ERROR: count < 30, aborting (expected ≥ 50 Fabric items)" >&2
  exit 1
fi

# ---- 7. Sample report ----
echo "Sample paths:"
find "${DIST_DIR}" -name '*.png' | sort | sed -n '1p;25p;$p'

echo "OK · upstream=${NPM_PKG}@${FABRIC_VERSION} count=${COUNT}"
