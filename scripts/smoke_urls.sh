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

command -v curl >/dev/null 2>&1 || { echo "ERROR: curl not installed"; exit 2; }

BASE="https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main"
USER_AGENT="azure-icons-smoke/0.5"

# Each entry: "URL|expected-content-type-prefix"
#   - 3 plain PNGs from different categories
#   - 1 monochrome variant with URL-encoded parentheses
#   - 1 plain-text USAGE-RULES.txt
URLS=(
  "${BASE}/dist/Azure/Compute/AzureVirtualMachine.png|image/"
  "${BASE}/dist/Azure/Storage/AzureStorage.png|image/"
  "${BASE}/dist/Azure/Networking/AzureLoadBalancer.png|image/"
  "${BASE}/dist/Azure/Compute/AzureVirtualMachine%28m%29.png|image/"
  "${BASE}/dist/Azure/USAGE-RULES.txt|text/plain"
)

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
