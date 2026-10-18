#!/usr/bin/env bash
# Fetch OpenPeppol BIS Billing 3 Schematron artefacts into reference-data/.
#
# These `.sch` files are *not* redistributed in this repository. OpenPeppol
# publishes them under terms that restrict redistribution without consent
# (the CEN EN 16931 artefact carries an EUPL header; that licence is the
# publisher's, not Klopt's). Obtain them from the official provenance below,
# then keep them locally (or in CI cache / the container image build) next to
# the rest of reference-data.
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
# When the pin moves, update EXPECTED_SHA256 below to match. Operators probing
# an unpinned ref may pass --skip-checksum; CI and the image build must not.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/reference-data/peppol/bis-3"
REF="${PEPPOL_BIS3_REF:-v3.0.20}"
BASE="https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/${REF}/rules/sch"
FORCE=0
SKIP_CHECKSUM=0

# SHA-256 of the pinned v3.0.20 bytes. Bump these together with the default REF.
CEN_SHA256=bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331
PEPPOL_SHA256=5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-checksum) SKIP_CHECKSUM=1 ;;
    -h | --help)
      sed -n '2,24p' "$0"
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

expected_sha256() {
  case "$1" in
    CEN-EN16931-UBL.sch) printf '%s' "${CEN_SHA256}" ;;
    PEPPOL-EN16931-UBL.sch) printf '%s' "${PEPPOL_SHA256}" ;;
    *)
      echo "no pinned checksum for $1" >&2
      return 1
      ;;
  esac
}

verify_sha256() {
  local path="$1" name="$2"
  local expected actual
  expected="$(expected_sha256 "${name}")"
  actual="$(sha256sum "${path}" | awk '{ print $1 }')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "checksum mismatch for ${path}" >&2
    echo "  expected: ${expected}" >&2
    echo "  actual:   ${actual}" >&2
    echo "re-fetch with --force, or bump CEN_SHA256/PEPPOL_SHA256 with REF." >&2
    return 1
  fi
}

mkdir -p "${DEST}"

need_fetch=0
for name in "${FILES[@]}"; do
  if [[ ! -s "${DEST}/${name}" ]]; then
    need_fetch=1
    break
  fi
done

if [[ "${need_fetch}" -eq 0 && "${FORCE}" -eq 0 ]]; then
  if [[ "${SKIP_CHECKSUM}" -eq 0 ]]; then
    if [[ "${REF}" != "v3.0.20" ]]; then
      echo "REF=${REF} is not the pinned release; pass --skip-checksum or bump the pin + checksums." >&2
      exit 1
    fi
    for name in "${FILES[@]}"; do
      verify_sha256 "${DEST}/${name}" "${name}"
    done
  fi
  echo "Peppol BIS-3 Schematron already present under ${DEST} (pass --force to re-fetch ${REF})."
  exit 0
fi

echo "Fetching Peppol BIS Billing 3 Schematron (${REF}) into ${DEST}"
echo "  upstream: https://github.com/OpenPEPPOL/peppol-bis-invoice-3/tree/${REF}/rules/sch"
echo "  docs:     https://docs.peppol.eu/poacc/billing/3.0/"

if [[ "${SKIP_CHECKSUM}" -eq 0 && "${REF}" != "v3.0.20" ]]; then
  echo "REF=${REF} is not the pinned release; pass --skip-checksum or bump the pin + checksums." >&2
  exit 1
fi

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
  if [[ "${SKIP_CHECKSUM}" -eq 0 ]]; then
    verify_sha256 "${tmp}" "${name}" || {
      rm -f "${tmp}"
      exit 1
    }
  fi
  mv "${tmp}" "${DEST}/${name}"
done

echo "Done. Files are local only — do not commit them (see reference-data/peppol/README.md)."
