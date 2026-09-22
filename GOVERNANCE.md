# Governance

## Licence: Apache-2.0, and it is not up for discussion

Anyone may fork Klopt, modify it, embed it in a commercial product, run a
competing hosted service, or sell support, with no obligation to give anything
back. That includes an incumbent taking it closed.

This was decided deliberately. The licence was never the moat: the moat is the
compliance treadmill, the accountant relationships, and the credentials the
hosted gateway holds. AGPL would not have protected any of those.

Relicensing to something stricter later would need the agreement of every
contributor, which makes this close to a one-way door. It is written down here
so that it does not get relitigated by every newcomer.

## No enterprise edition, ever

No feature gating, no open-core split. The self-hosted build is complete and
legal on its own.

The hosted offering sells the three things nobody wants to run themselves: the
PKIoverheid certificate, the bank aggregator contract, and the Peppol access
point. It sells operations and credentials. It never sells features. The moment
it withholds one, principle 4 is dead and the community notices the same week.

## Contribution model

- **DCO sign-off, not a CLA.** See `CONTRIBUTING.md`.
- Pull requests need appointed review, and CI green.
- **Only appointed people may merge to `main`.** For now that is **only
  Hidde**; further appointed maintainers may be added later. Opening a PR or a
  green CI run does not grant merge rights. See `CONTRIBUTING.md` and
  `docs/github-branch-protection.md`.
- A change to a regulated artefact needs a maintainer who owns that part of the
  compliance calendar.

## Roles

| Role             | What it means                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributor      | Anyone with a merged pull request                                                                                                                                            |
| Maintainer       | Merge rights in one or more areas; listed in `MAINTAINERS.md`                                                                                                                |
| Compliance owner | A named maintainer who owns the compliance calendar (see `docs/compliance-calendar.md`) and is accountable for the annual artefact updates landing before they are mandatory |

The compliance owner role is not ceremonial. A yearly Nederlandse Taxonomie, two
Peppol BIS releases and an RGS version each year is the risk that kills projects
of this shape, and an unowned calendar is how it kills them.

## Releases

Releases are **signed and reproducible**. A permissive licence means anyone may
distribute a modified copy under a similar name, so users need a way to verify
they are running the official build. Every release ships checksums and a
signature, and the release workflow is in the repository.

## Trademark

The code is free. The name is not. See `TRADEMARK.md`.
