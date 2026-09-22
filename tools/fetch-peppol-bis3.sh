#!/usr/bin/env bash
# Fetch OpenPeppol BIS Billing 3 Schematron artefacts into reference-data/.
#
# These `.sch` files are *not* redistributed in this repository. OpenPeppol
# publishes them under terms that restrict redistribution without consent
# (the CEN EN 16931 artefact carries an EUPL header; that licence is the
# publisher's, not Klopt's). Obtain them from the official provenance below,
# then keep them locally (or in CI cache) next to the rest of reference-data.
#
# Provenance:
#   Spec / downloads: https://docs.peppol.eu/poacc/billing/3.0/
#   Source tree:      https://github.com/OpenPEPPOL/peppol-bis-invoice-3
#
# Usage:
#   pnpm run peppol:fetch
#   tools/fetch-peppol-bis3.sh [--force]
#
# Override the pin with PEPPOL_BIS3_REF (a tag or commit on the upstream repo).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/reference-data/peppol/bis-3"
REF="${PEPPOL_BIS3_REF:-v3.0.20}"
BASE="https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/${REF}/rules/sch"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

FILES=(
  CEN-EN16931-UBL.sch
  PEPPOL-EN16931-UBL.sch
)

mkdir -p "${DEST}"

need_fetch=0
for name in "${FILES[@]}"; do
  if [[ ! -s "${DEST}/${name}" ]]; then
    need_fetch=1
    break
  fi
done

if [[ "${need_fetch}" -eq 0 && "${FORCE}" -eq 0 ]]; then
  echo "Peppol BIS-3 Schematron already present under ${DEST} (pass --force to re-fetch ${REF})."
  exit 0
fi

echo "Fetching Peppol BIS Billing 3 Schematron (${REF}) into ${DEST}"
echo "  upstream: https://github.com/OpenPEPPOL/peppol-bis-invoice-3/tree/${REF}/rules/sch"
echo "  docs:     https://docs.peppol.eu/poacc/billing/3.0/"

for name in "${FILES[@]}"; do
  url="${BASE}/${name}"
  tmp="${DEST}/.${name}.tmp"
  echo "  ${name}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "${tmp}" "${url}"
  else
    echo "need curl or wget to download ${url}" >&2
    exit 1
  fi
  if [[ ! -s "${tmp}" ]]; then
    echo "download produced an empty file: ${url}" >&2
    rm -f "${tmp}"
    exit 1
  fi
  # Cheap sanity check: Schematron is XML with a <schema> root.
  if ! grep -q '<schema' "${tmp}"; then
    echo "download does not look like Schematron: ${url}" >&2
    rm -f "${tmp}"
    exit 1
  fi
  mv "${tmp}" "${DEST}/${name}"
done

echo "Done. Files are local only — do not commit them (see reference-data/peppol/README.md)."
