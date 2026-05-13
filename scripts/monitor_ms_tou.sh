#!/usr/bin/env bash
# Microsoft Azure Architecture Icons Terms-of-Use monitor.
#
# Fetches the live ToU page, extracts the canonical "Icon terms" + "Don'ts"
# blocks, and diffs them against the workspace baseline at
# dist/baselines/microsoft-azure-icons-tou.txt.
#
# Exit codes:
#   0 — baseline unchanged.
#   1 — baseline drifted (license re-audit owed before next icon refresh).
#   2 — environment problem (network unreachable, parse failed, etc.).
#
# The drift gate is intentionally narrow: only the verbatim Microsoft
# permission text + the three Don'ts. The surrounding page chrome (TOC,
# nav, breadcrumbs, "Icon updates" month-by-month table) is volatile and
# would produce false-positive drifts; we skip it.

set -uo pipefail

URL="https://learn.microsoft.com/en-us/azure/architecture/icons/"
BASELINE="${BASELINE:-dist/baselines/microsoft-azure-icons-tou.txt}"

if [ ! -f "${BASELINE}" ]; then
  echo "FAIL: baseline missing at ${BASELINE}" >&2
  exit 2
fi

tmpfetch=$(mktemp) || exit 2
tmpextract=$(mktemp) || { rm -f "${tmpfetch}"; exit 2; }
trap 'rm -f "${tmpfetch}" "${tmpextract}"' EXIT

# Fetch the page.
if ! curl -fsSL --max-time 30 "${URL}" > "${tmpfetch}" 2>/dev/null; then
  echo "FAIL: could not fetch ${URL} (exit 2)" >&2
  exit 2
fi

# Convert HTML → text. Prefer w3m if available (most stable extraction);
# fall back to lynx; if neither is present, exit 2.
if command -v w3m >/dev/null 2>&1; then
  w3m -dump -cols 200 "${tmpfetch}" > "${tmpextract}" 2>/dev/null || {
    echo "FAIL: w3m -dump failed" >&2
    exit 2
  }
elif command -v lynx >/dev/null 2>&1; then
  lynx -dump -width=200 "${tmpfetch}" > "${tmpextract}" 2>/dev/null || {
    echo "FAIL: lynx -dump failed" >&2
    exit 2
  }
else
  echo "FAIL: neither w3m nor lynx is installed" >&2
  exit 2
fi

# Extract the canonical sections.
canonical=$(mktemp) || exit 2
trap 'rm -f "${tmpfetch}" "${tmpextract}" "${canonical}"' EXIT

{
  printf '# Canonical extract of the Microsoft Azure Architecture Icons Terms of Use.\n'
  printf '# Source: %s\n' "${URL}"
  printf '# Captured: 2026-05-11.\n'
  printf '# This file is the baseline that scripts/monitor_ms_tou.sh diffs against.\n'
  printf '# If the upstream ToU changes, the monitor fails, an issue is opened, and\n'
  printf '# a license re-audit is owed before the next icon refresh.\n'
  printf '\n'
  printf '[ICON TERMS]\n'
  grep -A1 -F 'Microsoft permits the use of these icons' "${tmpextract}" | head -2 | tail -1 || true
  printf '\n'
  printf "[DON'TS]\n"
  grep -E "^Don't (crop|distort|use Microsoft)" "${tmpextract}" || true
} > "${canonical}"

if diff -u "${BASELINE}" "${canonical}" >/dev/null 2>&1; then
  echo "PASS: Microsoft Azure Icons ToU baseline unchanged"
  exit 0
fi

echo "FAIL: Microsoft Azure Icons ToU baseline drifted" >&2
echo "--- baseline (${BASELINE}) +++ live (${URL})" >&2
diff -u "${BASELINE}" "${canonical}" | head -40 >&2
exit 1
