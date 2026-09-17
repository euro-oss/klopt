# 0011. RGS ships as generated reference data, not as code

Status: Accepted
Date: 2026-09-04

## Context

Principle 6: "Taxonomies, schematrons and validation artefacts are data loaded
at runtime, never code. Every one of them changes annually."

RGS 3.7 is published as an Excel workbook. The MKB sheet is 3691 codes across
five levels, with omslagcodes and ten applicability filters. There is no
official JSON or CSV distribution and no API.

## Decision

Three separate things, deliberately:

1. **`tools/rgs-import`** converts the published workbook into JSON. A
   maintainer task run when the RGS Beheergroep publishes a version, not a
   runtime dependency. It reads xlsx with about 120 lines of unzip-plus-XML
   rather than a spreadsheet library, because one task that runs twice a year
   does not justify the dependency.

2. **`reference-data/rgs/rgs-3.7-mkb.json`** is committed, pretty-printed and
   sorted. It is generated, and it is reviewed by diffing it. That is the
   mechanism the spec asks for when it says an RGS upgrade is "a migration with
   a diff report, never a silent remap".

3. **`@klopt/core/reference`** loads it at boot and validates it while loading.
   Nothing in the domain knows what is in RGS 3.7 — only what an RGS scheme
   looks like.

**The importer is strict and fails loudly.** Unexpected column, duplicate code,
level outside 1–5, or a row without a reference code appearing _between_ rows
that have one: all hard errors. Trailing blank and totals rows are expected and
skipped. If the workbook layout moves, the import stops rather than quietly
dropping codes.

**Corrections to the published data are recorded, not applied silently.** RGS
3.7 has one lowercase `c` in the D/C column, for `BEivWerRlaAvh`. The generated
file lists that under `normalisations`. It is visible in review, and it will
disappear from the diff if a future release fixes it upstream.

Only the MKB variant ships. The full scheme (4963 codes) and WoCo are in the
same workbook and generate with a different argument.

## Consequences

- A 1.5 MB JSON file in the repository. It compresses well and it is the thing
  an RGS upgrade is reviewed against, so readability beats size.
- Two schemes can be loaded at once, which the upgrade diff needs.
- An installation can point `KLOPT_REFERENCE_DATA_DIR` elsewhere and run a
  scheme we have never seen. That is the intent.
- Nobody has checked whether the RGS Beheergroep's terms allow redistributing
  the derived data. **Confirm before the repository goes public**; if not, the
  generated file comes out of the repository and the importer becomes an
  install step.
