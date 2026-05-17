#!/usr/bin/env bash
# Verify a representative sample of public raw URLs from this repository
# are reachable and return the expected content type. Re-runnable any
# time; no side effects.
#
# Intended to be invoked manually now and as a release gate by future
# CI workflows.
#
# Exit codes:
#   0 — all probed URLs returned HTTP 200, non-zero body, and a
#       Content-Type starting with the expected prefix.
#   1 — at least one URL failed any of the above.
#   2 — environment problem (curl missing); could not run the smoke.
#
# no -e: per-URL accounting in the loop must complete; failures are
# aggregated into the FAILED counter and surfaced via exit code.
set -uo pipefail
export LC_ALL=C

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not installed" >&2; exit 2; }
command -v shuf >/dev/null 2>&1 || { echo "ERROR: shuf not installed (apt install coreutils)" >&2; exit 2; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- Derive OWNER/REPO/BRANCH from git config; allow env override ----
ORIGIN=$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || true)
ORIGIN_NORMALIZED=${ORIGIN#git@github.com:}
ORIGIN_NORMALIZED=${ORIGIN_NORMALIZED#https://github.com/}
ORIGIN_NORMALIZED=${ORIGIN_NORMALIZED%.git}
OWNER="${BASE_OWNER:-${ORIGIN_NORMALIZED%/*}}"
REPO="${BASE_REPO:-${ORIGIN_NORMALIZED#*/}}"
BRANCH="${BASE_BRANCH:-$(git -C "$REPO_ROOT" symbolic-ref --short HEAD 2>/dev/null || echo main)}"
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "ERROR: cannot derive OWNER/REPO from git config; set BASE_OWNER + BASE_REPO env" >&2
  exit 2
fi
BASE="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
USER_AGENT="azure-icons-smoke/0.6"
echo "smoke_urls.sh: probing ${OWNER}/${REPO}@${BRANCH}" >&2

# ---- Per-category random sample (one colored PNG per Azure category) ----
# Skip monochrome '(m)' variants so the sample stays readable + URL-encoding-free.
URLS=()
for CAT in "$REPO_ROOT"/dist/Azure/*/; do
  [ -d "$CAT" ] || continue
  ICON=$(find "$CAT" -name '*.png' ! -name '*(m).png' 2>/dev/null | shuf -n 1)
  if [ -n "$ICON" ]; then
    REL_PATH=${ICON#"$REPO_ROOT"/}
    URLS+=("${BASE}/${REL_PATH}|image/")
  fi
done
# Fabric: flat icon set (no per-category subdirs), sample 5 random size-40 PNGs
# across all three upstream naming patterns (_40_item, _40_non-item, _40).
FABRIC_DIR="$REPO_ROOT/dist/Fabric/png"
if [ -d "$FABRIC_DIR" ]; then
  while IFS= read -r ICON; do
    REL_PATH=${ICON#"$REPO_ROOT"/}
    URLS+=("${BASE}/${REL_PATH}|image/")
  done < <(find "$FABRIC_DIR" \
             \( -name '*_40_item.png' -o -name '*_40_non-item.png' -o -name '*_40.png' \) \
             2>/dev/null | shuf -n 5)
fi
# Kubernetes: subdir-structured icon set (labeled / unlabeled × resources /
# control_plane / infrastructure). Sample one PNG per subdir family for
# per-subdir coverage parity with Azure's per-category sample.
KUBE_DIR="$REPO_ROOT/dist/Kubernetes/png"
if [ -d "$KUBE_DIR" ]; then
  for SUB in resources/labeled control_plane_components/labeled infrastructure_components/labeled; do
    SUBDIR="$KUBE_DIR/$SUB"
    [ -d "$SUBDIR" ] || continue
    ICON=$(find "$SUBDIR" -name '*-128.png' 2>/dev/null | shuf -n 1)
    if [ -n "$ICON" ]; then
      REL_PATH=${ICON#"$REPO_ROOT"/}
      URLS+=("${BASE}/${REL_PATH}|image/")
    fi
  done
fi
# Always probe USAGE-RULES.txt for each icon family (NOTICE-companion artifact).
URLS+=("${BASE}/dist/Azure/USAGE-RULES.txt|text/plain")
if [ -f "$REPO_ROOT/dist/Fabric/USAGE-RULES.txt" ]; then
  URLS+=("${BASE}/dist/Fabric/USAGE-RULES.txt|text/plain")
fi
echo "smoke_urls.sh: sampling ${#URLS[@]} URLs (Azure per-category + Fabric sample + Kubernetes per-subdir + USAGE-RULES.txt)" >&2

FAILED=0
FMT='%-7s %-10s %-30s %s\n'
# shellcheck disable=SC2059
printf "$FMT" "STATUS" "BYTES" "CONTENT-TYPE" "URL"
# shellcheck disable=SC2059
printf "$FMT" "------" "-----" "------------" "---"

for entry in "${URLS[@]}"; do
  url="${entry%%|*}"
  expected_ct="${entry##*|}"

  read -r http_code size content_type < <(
    curl -sSL -A "$USER_AGENT" \
         --connect-timeout 5 --max-time 30 \
         --retry 2 --retry-delay 1 \
         -o /dev/null \
         -w '%{http_code} %{size_download} %{content_type}\n' \
         "$url"
  )

  size="${size:-0}"
  http_code="${http_code:-000}"
  content_type="${content_type:-(none)}"

  if [ "$http_code" = "200" ] && [ "$size" -gt 0 ] && \
     [[ "$content_type" == "$expected_ct"* ]]; then
    verdict="PASS"
  else
    verdict="FAIL"
    FAILED=$((FAILED + 1))
  fi
  # shellcheck disable=SC2059
  printf "$FMT" "$verdict" "$size" "$content_type" "$url"
done

echo
if [ "$FAILED" -gt 0 ]; then
  echo "Smoke FAILED: ${FAILED} URL(s) did not pass (HTTP 200 + non-zero body + matching Content-Type)."
  exit 1
fi
echo "Smoke OK: all ${#URLS[@]} URLs returned HTTP 200 with non-zero body and expected Content-Type."
