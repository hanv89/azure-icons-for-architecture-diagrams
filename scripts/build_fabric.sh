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
# Scope filter (Phase 1.1 spec Q1): convert only `*_40_item.svg` from the
# 1598-SVG upstream package. That subset (55 icons at @fabric-msft/svg-icons@7.0.1)
# is the Microsoft-branded Fabric items (Lakehouse, Pipeline, Notebook,
# Warehouse, etc.) — the iconography people draw on architecture diagrams.
# The other variants (`_non-item`, `_filled`, `_regular`, sizes 12/20/24/32/48/64)
# are UI affordances + multi-size duplicates not useful in PlantUML <img:> use.

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
# Scope filter: only `*_40_item.svg` per Phase 1.1 spec Q1.
SVG_LIST=$(find "${SVG_DIR}" -name '*_40_item.svg' | sort)
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
  # Output filename: e.g. lakehouse_40_item.png (upstream naming preserved)
  NAME=$(basename "${SVG}" .svg)
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
