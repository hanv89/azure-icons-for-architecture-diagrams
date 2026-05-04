#!/usr/bin/env bash
# Verify a representative sample of public raw URLs from this repository
# are reachable. Exits non-zero if any URL fails (HTTP != 200 or
# zero-byte response). Re-runnable any time; no side effects.
set -uo pipefail

BASE="https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main"

# Representative sample:
#   - 3 plain PNGs from different categories
#   - 1 monochrome variant with URL-encoded parentheses
#   - 1 plain-text USAGE-RULES.txt
URLS=(
  "${BASE}/dist/Azure/Compute/AzureVirtualMachine.png"
  "${BASE}/dist/Azure/Storage/AzureStorage.png"
  "${BASE}/dist/Azure/Networking/AzureLoadBalancer.png"
  "${BASE}/dist/Azure/Compute/AzureVirtualMachine%28m%29.png"
  "${BASE}/dist/Azure/USAGE-RULES.txt"
)

FAILED=0
printf '%-7s %-10s %-25s %s\n' "STATUS" "BYTES" "CONTENT-TYPE" "URL"
printf '%-7s %-10s %-25s %s\n' "------" "-----" "------------" "---"

for url in "${URLS[@]}"; do
  read -r http_code size content_type < <(
    curl -sSL -o /dev/null --max-time 10 \
         -w '%{http_code} %{size_download} %{content_type}\n' \
         "$url"
  )
  if [ "$http_code" = "200" ] && [ "$size" -gt 0 ]; then
    verdict="PASS"
  else
    verdict="FAIL"
    FAILED=$((FAILED + 1))
  fi
  printf '%-7s %-10s %-25s %s\n' "$verdict" "$size" "$content_type" "$url"
done

echo
if [ "$FAILED" -gt 0 ]; then
  echo "Smoke FAILED: ${FAILED} URL(s) did not return HTTP 200 with non-zero body."
  exit 1
fi
echo "Smoke OK: all ${#URLS[@]} URLs returned HTTP 200 with non-zero body."
