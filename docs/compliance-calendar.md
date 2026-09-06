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
| Peppol BIS Billing 3.0     | OpenPeppol                   | Roughly twice a year                      | Two versions must be runnable simultaneously during a transition window   |
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
