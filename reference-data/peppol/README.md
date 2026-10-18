# Peppol BIS Billing 3 Schematron

The `.sch` artefacts that live in `bis-3/` are **not committed** to this
repository.

OpenPeppol publishes Peppol BIS Billing 3 validation rules as ISO Schematron.
Redistributing those files from this tree without consent conflicts with the
publisher's terms (the CEN EN 16931 UBL artefact ships with an EUPL header —
that is the publisher's licence statement, not a licence Klopt claims for the
project). Path A for public readiness is therefore: **fetch from official
provenance, keep locally / in CI cache / the container image build, do not
redistribute in-repo.** Attribution and licence boundaries are recorded in
[`NOTICE`](../../NOTICE).

## Obtain the artefacts

```bash
pnpm run peppol:fetch
# or: tools/fetch-peppol-bis3.sh
```

That writes:

- `bis-3/CEN-EN16931-UBL.sch` — EN 16931 / TC434 rules bound to UBL
- `bis-3/PEPPOL-EN16931-UBL.sch` — Peppol BIS 3.0 Billing (+ NLCIUS) rules

into this directory. They are gitignored. The fetch is pinned to a release tag
and **SHA-256 verified** (`CEN_SHA256` / `PEPPOL_SHA256` in the script). Re-run
with `--force` after bumping the pin and checksums together (or set
`PEPPOL_BIS3_REF` with `--skip-checksum` only when probing).

The Docker image build runs the same fetch and copies `reference-data/` to
`/app/reference-data` with `KLOPT_REFERENCE_DATA_DIR` set, so hosted deploys
cannot ship the tree without the artefacts.

## Provenance

| What                                     | Where                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Spec and release downloads               | [docs.peppol.eu — Peppol BIS Billing 3.0](https://docs.peppol.eu/poacc/billing/3.0/)               |
| Source tree (pinned by the fetch script) | [OpenPEPPOL/peppol-bis-invoice-3](https://github.com/OpenPEPPOL/peppol-bis-invoice-3) `rules/sch/` |
| Release notes                            | Linked from the docs site for each BIS release                                                     |

The runtime loads every `*.sch` in `bis-3/` in filename order
([ADR 0017](../../docs/decisions/0017-schematron-in-process.md)). Override the
reference-data root with `KLOPT_REFERENCE_DATA_DIR` if you self-host the files
elsewhere.

## Updating on a BIS release

1. Check the OpenPeppol release notes and bump `PEPPOL_BIS3_REF` / the default
   pin in `tools/fetch-peppol-bis3.sh`.
2. `pnpm run peppol:fetch -- --force`
3. Run the schematron tests; review golden UBL diffs if any.
4. Note the release in [`docs/compliance-calendar.md`](../../docs/compliance-calendar.md).
