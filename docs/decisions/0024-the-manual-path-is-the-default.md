# 0024. The manual filing path is the default, and Digipoort's signature is a seam

Status: Accepted
Date: 2026-09-07

## Context

Spec 7.2 asks for the XBRL instance, local validation, and a filing transport
adapter with three implementations: Digipoort direct, a third-party SBR service
provider, and manual. It then says the thing that decides the priority:

> Do not make a self-hoster buy a certificate to be compliant. The manual path
> must be a first-class, well-documented flow.

Digipoort direct needs a PKIoverheid services certificate at a few hundred euro
a year **per legal entity**, an aansluitformulier submitted to Logius, and the
WUS 2.0 for Companies interface: SOAP with WS-Addressing, two-way TLS, and
WS-Security message signing.

## Decision

**Manual is the default and needs nothing.** It generates the instance and a
human-readable summary, records both, and tells the operator what to do with
them in numbered steps. It is not a stub and not a fallback: the figures come
from the journal and are correct whatever the XBRL elements turn out to be
called, and somebody typing twenty-one boxes into Mijn Belastingdienst Zakelijk
gets exactly the same evidence chain as somebody with a certificate. The only
difference is who presses the last button.

**The SBR provider transport is generic on purpose.** There is no standard API
across providers, so it POSTs the instance to a configured URL with a bearer
token and polls a status URL. A provider whose API differs gets its own adapter
— the port is the contract, not that file.

**Digipoort's WS-Security signature is a seam with no default.** The envelopes
are implemented and tested against golden assertions, because they are the
fiddly mechanical part and they can be got right without a certificate. The
two-way TLS is implemented, through `node:https`, because a client certificate
is configuration rather than cryptography. But signing means exclusive XML
canonicalisation and an enveloped RSA-SHA256 signature over the body and the
addressing headers, and a subtly wrong canonicalisation produces a signature
Digipoort rejects with a message that explains nothing.

That cannot be verified from a test suite. It needs a test certificate and a run
against Logius's pre-production environment. Shipping an unverifiable signer and
calling the transport finished would be the same mistake as shipping a
schematron engine nobody had run — see ADR 0017 — so `available()` returns false
with the reason, and the operator sees a greyed-out option that explains itself
rather than an error after generating a filing.

**This is a stated gap, not a hidden one.** The remaining work is: a
`DigipoortSigner` implementation, a test certificate from Logius, and a
pre-production run. Everything around it is done and tested.

## Received is not accepted

`deliver` and `status` are two calls because that is the shape of the problem.
Digipoort taking the bytes means it received them; whether the Belastingdienst
processed them is a separate question with its own answer, sometimes days later.
Collapsing the two into "sent" is how a rejected aangifte goes unnoticed until a
letter arrives, so `FilingStatus` has both `delivered` and `accepted` and an
unrecognised status word maps to `delivered` rather than `accepted`. Guessing
optimistically from an unknown word reports a rejection as done.

For the same reason a failed _poll_ leaves the status at `delivered` rather than
moving it to `failed`: the filing's own state has not changed, we simply could
not ask. Recording an outage as a rejection would be worse than recording
nothing.

## Whole euros, rounded once

The aangifte is filed in whole euros and the ledger is in cents, so something
has to round. Where it rounds decides whether the filing is internally
consistent:

- Sum the cents, compute 5a and 5c, then round the totals — and the boxes no
  longer add up, because 1a and 1b rounded individually need not equal their
  rounded sum. An aangifte whose own arithmetic fails gets rejected.
- Round each declared box, then derive 5a, 5b and 5c from the rounded boxes —
  and every figure on the form is exactly the sum of the figures above it.

The second. The consequence is that the instance can differ from the
cent-accurate return by a euro or two, so the difference is reported in the
summary rather than hidden. It is also why the **reconciliation** runs against
the cent-accurate return while the **instance** carries whole euros:
reconciling against a rounded figure would turn rounding into a blocking
difference every quarter.

Rounding is half away from zero, on integers only: `(cents + 50) / 100` on
bigints with the sign handled explicitly. No `Math.round`, no float.

## The taxonomy is selected by period, never by "latest"

Spec 7.2 says so, and the reason is a January problem: a Q4 2026 aangifte filed
in January 2027 must go out against the taxonomy current _for 2026_, not the one
that happens to be newest when somebody presses the button. So a mapping
declares the periods it applies to, selection looks only at that, and a period
with no mapping is a refusal naming the version needed. There is deliberately no
fallback — an instance quietly built against next year's taxonomy is the failure
this prevents.

Two mappings claiming one period is also a refusal rather than a choice: one of
them has the wrong window and picking either would be a guess about which.

## `verified: false`

The mapping shipped in this repository is **unverified**. Its element names, its
`schemaRef` and its dictionary namespace were written from public documentation
and have not been checked against the published Nederlandse Taxonomie; the date
segments in both URIs are certainly wrong.

This is handled the same way as every other compliance artefact this project
cannot obtain from where it sits — the RGS redistribution terms, the ISO 20022
XSDs, the Peppol schematrons. The flag has teeth:

- The instance is still generated, and the summary still shows the figures,
  because an operator filing by hand does not care what the elements are called.
- Both electronic transports **refuse** an unverified mapping before sending
  anything. A well-formed instance that declares the wrong box is the worst
  available outcome, and it is what this flag exists to prevent.
- The screen and the summary say so, in Dutch, above the figures.

Verifying it is one file and one flag: replace the element names from the
entrypoint published by SBR Nederland and set `verified: true`.

## Consequences

- **Credentials come from the environment, not the database.** Spec 8's second
  rule wants them per entity and encrypted, and an accountancy firm with forty
  administrations needs forty certificates. That is a real gap and this is where
  it is recorded.
- **The instance is not validated against the taxonomy.** Doing so needs the
  taxonomy's schemas and linkbases — thousands of files an operator downloads —
  so it is a separate concern with its own port, exactly as the Peppol
  schematrons are. What is validated locally is the mapping's completeness: a
  box with a figure and no element to put it in is a refusal.
- **Filing now needs the entity's own VAT number**, which setting up an
  administration deliberately does not ask for. Discovered by a browser test:
  the failure arrived on submit. It is now reported above the button with a link
  to Instellingen, which is the same treatment the UBL generator gives a missing
  address.
- `XmlWriter` moved to `packages/core/src/xml/writer.ts`. Three generators needed
  it and the third arriving is the moment to stop copying it.
