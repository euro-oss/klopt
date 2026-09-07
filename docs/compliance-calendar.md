# Compliance calendar

> The build is not what kills projects like this. The treadmill is.
> — requirements, section 16

Every artefact below changes on someone else's schedule. A named maintainer owns
this file (see `GOVERNANCE.md`), and "owns" means accountable for the update
landing before it is mandatory, not for noticing afterwards.

## The treadmill

| Artefact                   | Publisher                    | Cadence                                   | Notes                                                                     |
| -------------------------- | ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Nederlandse Taxonomie (NT) | SBR / Belastingdienst        | Annual, through alpha → beta → definitive | Filing selects the taxonomy by **reporting period**, never "latest"       |
| Peppol BIS Billing 3.0     | OpenPeppol                   | Roughly twice a year                      | Replace the `.sch` and restart; nothing is compiled (ADR 0017)            |
| NLCIUS / SI-UBL            | Nederlandse Peppolautoriteit | Follows BIS                               | The NL-R rules ship inside the BIS schematron, not separately             |
| UBL 2.1 schemas            | OASIS                        | Frozen; 2.1 is what BIS 3.0 profiles      | Committed verbatim under `reference-data/ubl/`                            |
| RGS scheme                 | referentiegrootboekschema.nl | Irregular, roughly annual                 | A version upgrade is a migration with a diff report, never a silent remap |
| XAF                        | Belastingdienst ODB          | Rare; 3.2 is current                      | RGS lead codes are the part under active push                             |
| PSD2 → PSD3 / PSR          | EU                           | Multi-year                                | Affects the bank feed adapter, not the file import path                   |
| ViDA                       | European Commission          | Mandate lands 2030                        | Assume every invoice becomes structured                                   |

## Dates to fill in

Left empty on purpose. Filling them in requires checking the publishers, and a
guessed date is worse than a blank one.

| What                      | Date | Owner |
| ------------------------- | ---- | ----- |
| NT alpha published        |      |       |
| NT beta published         |      |       |
| NT definitive published   |      |       |
| NT mandatory from         |      |       |
| Peppol BIS spring release |      |       |
| Peppol BIS autumn release |      |       |
| RGS version review        |      |       |

## How an update is supposed to feel

1. The publisher releases. CI's artefact job goes red within days, because it
   validates the golden files against the official schema and schematron on
   every commit.
2. The new taxonomy, schematron or scheme is added as **versioned reference
   data**, loaded at runtime. It is a data release, not a deploy (principle 6).
3. The golden-file diff is reviewed by the compliance owner and lands with the
   data.
4. The old version stays loadable for as long as a period can still be filed
   against it.

If an update ever requires changing code in `packages/core`, that is a signal
the artefact was hard-coded somewhere it should not have been. Fix that instead.

## If the RGS data cannot be redistributed

[ADR 0011](decisions/0011-rgs-as-reference-data.md) commits the generated
`reference-data/rgs/rgs-3.7-mkb.json` to the repository and flags that nobody
has confirmed the RGS Beheergroep's terms allow it. The site publishes no
licence or terms page, and RGS is stewarded through SBR-NL, so the answer is
probably yes — but "probably" is not what belongs under a public repository.

**It is one question to the RGS Beheergroep**, and it is not a technical
blocker. Ask them: may the RGS workbook be converted to another format and that
derived file redistributed under Apache-2.0, with attribution?

The fallback is deliberately cheap, so the answer does not need to arrive before
anything else can be built:

1. `git rm reference-data/rgs/*.json` and add the path to `.gitignore`.
2. A self-hoster runs `pnpm rgs:generate` once, against a workbook they
   downloaded themselves. The importer already exists and is the supported path.
3. Nothing else changes. `@klopt/core/reference` fails at boot with a message
   that names the command, and `KLOPT_REFERENCE_DATA_DIR` already lets an
   installation point at its own copy.

The same question will arise for anything else derived from a published
artefact. The Peppol schematron and the UBL schemas are redistributed under
their own terms — CEN grants permission in the schematron header, and OASIS
publishes UBL under a policy that allows it.
