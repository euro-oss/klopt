# Reference data

Compliance artefacts, as **versioned data loaded at runtime, never code**
(principle 6). Every one of these changes on somebody else's schedule — see
[`docs/compliance-calendar.md`](../docs/compliance-calendar.md) — and updating
one must be a data release, not a deploy.

| Directory | Artefact                        | Source                                                                   | Regenerate with                                         |
| --------- | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `rgs/`    | RGS reference chart of accounts | [referentiegrootboekschema.nl](https://www.referentiegrootboekschema.nl) | `pnpm rgs:generate <workbook.xlsx> <version> [variant]` |
| `xaf/`    | XML Auditfile Financieel schema | Belastingdienst ODB / auditfiles.nl                                      | Downloaded verbatim; never edited                       |

The runtime reads this directory. `KLOPT_REFERENCE_DATA_DIR` overrides the
location; the container image ships it at `/app/reference-data`.

## rgs/

`rgs-3.7-mkb.json` is generated from the official "Definitief RGS 3.7.xlsx",
MKB sheet: 3691 codes, levels 1 to 5, with omslagcodes and the applicability
filters carried through verbatim.

Two things to know about it:

- **It is generated, and the generator is strict.** `tools/rgs-import` fails on
  an unexpected column, a duplicate code, a level outside 1–5, or a row without
  a reference code appearing between rows that have one. If the workbook layout
  moves, the import stops rather than silently dropping codes.
- **Corrections are recorded, not applied silently.** The published 3.7 workbook
  has one lowercase `c` in the D/C column for `BEivWerRlaAvh`. The generated
  file lists that under `normalisations`, so it is visible in review and will
  disappear from the diff if a future release fixes it upstream.

Only the MKB variant ships. The full scheme (4963 codes) and the WoCo variant
are in the same workbook and can be generated with
`pnpm rgs:generate <workbook> 3.7 full`.

## xaf/

`XmlAuditfileFinancieel3.2.xsd` is the published schema, byte for byte. CI
validates every generated auditfile against it with `xmllint`, which is what
turns a spec change into a red build rather than a support ticket.
