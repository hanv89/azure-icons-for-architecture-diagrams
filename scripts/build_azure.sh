#!/usr/bin/env bash
# Reproducible Azure icon build (Variant B — Azure-PlantUML upstream).
# Idempotent: safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${REPO_ROOT}/source/Azure-PlantUML"
DIST_DIR="${REPO_ROOT}/dist/Azure"
UPSTREAM_URL="https://github.com/plantuml-stdlib/Azure-PlantUML.git"

# 1. Ensure upstream cloned (shallow, master branch)
if [ ! -d "${SOURCE_DIR}/.git" ]; then
  echo "Cloning Azure-PlantUML upstream..."
  mkdir -p "${REPO_ROOT}/source"
  git clone --depth 1 --branch master "${UPSTREAM_URL}" "${SOURCE_DIR}"
else
  echo "Refreshing existing clone..."
  git -C "${SOURCE_DIR}" fetch --depth 1 origin master
  git -C "${SOURCE_DIR}" reset --hard origin/master
fi

UPSTREAM_SHA="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
echo "Upstream SHA: ${UPSTREAM_SHA}"

# 2. Clean dist/Azure (preserve the directory itself)
echo "Cleaning ${DIST_DIR}..."
mkdir -p "${DIST_DIR}"
find "${DIST_DIR}" -mindepth 1 -delete

# 3. Copy *.png only, preserving category structure
echo "Copying PNGs..."
rsync -a \
  --include='*/' \
  --include='*.png' \
  --exclude='*' \
  "${SOURCE_DIR}/dist/" "${DIST_DIR}/"

# 4. Drop empty directories left by the include/exclude filter
find "${DIST_DIR}" -type d -empty -delete

# 5. Verify
COUNT="$(find "${DIST_DIR}" -name '*.png' | wc -l)"
echo "PNG count: ${COUNT}"
if [ "${COUNT}" -lt 500 ]; then
  echo "ERROR: count < 500, aborting"
  exit 1
fi

# 6. Sample report
echo "Sample paths:"
find "${DIST_DIR}" -name '*.png' | sort | sed -n '1p;100p;$p'

echo "OK · upstream=${UPSTREAM_SHA} count=${COUNT}"
