# 0016. UBL generation lands before schematron execution, and nothing sends until it arrives

Status: Accepted
Date: 2026-09-06

## Context

Spec 7.5: "Generate UBL 2.1 conforming to Peppol BIS Billing 3.0 with the NLCIUS
rules applied. Validate against the current schematron **before** send."

Those are two pieces of work, and only the first is small. Generation is a
mapping from our invoice to an ordered XSD sequence — mechanical, testable
against the published schema with `xmllint`, done. Validation is not: the BIS
and NLCIUS rules ship as Schematron (`.sch`), the official artefacts are not
published pre-compiled, and running them means compiling `.sch` to XSLT 2.0 with
the ISO skeleton and then executing that with an XSLT 2.0 processor — SaxonJS,
which is a real dependency and a real toolchain.

Doing generation and calling e-invoicing done would be worse than not doing it.
An invoice that passes the XSD and fails the schematron is exactly the invoice
that gets silently rejected by the customer's system a week later.

## Decision

**Generation lands now, with XSD validation and golden files. Schematron
execution lands next. Until it does, nothing in the product sends an invoice.**

You can generate a UBL invoice and download it —
`GET /api/v1/sales-invoices/{id}/ubl` — and that is exactly as far as it is safe
to go without the authority. There is no `EInvoiceTransport`, no send button and
no email delivery of a UBL in this change, so the rule "validate before send"
cannot be violated by something that does not exist.

In its place, `checkUblRules` is a **pre-flight subset**: about thirty rules
implemented in code, each carrying the official identifier and the official
message copied from `reference-data/peppol/bis-3/`. It covers what our own
generator can get wrong — a missing seller address, a credit note with no
reference to what it credits, a VAT breakdown that does not match the lines, a
reverse charge with no exemption reason. It does not cover allowances, charges,
delivery, tax representatives or invoice periods, because nothing here can
produce those constructs yet.

Keeping the official ids is the point. A bookkeeper reads the message, an
integrator branches on `NL-R-002`, and when the schematron lands, the two can be
compared rule by rule — a rule that fires there and not here is a gap with a
name.

The `.sch` sources are committed alongside the UBL schemas as reference data
now, unused, so that the diff when a BIS release lands is visible from the first
release rather than from the one after the schematron work.

## Consequences

An invoice can be produced and handed to a customer today, by whatever means
they already use, and it is a real BIS Billing 3.0 document validated against
the published OASIS schema in CI. That is most of the value of e-invoicing for a
Dutch SMB, which mostly exchanges by email (spec 7.5's own fallback transport).

What is deferred is the guarantee, not the format. The open work is: a
`tools/peppol-import` that compiles the schematron the way `tools/rgs-import`
generates the RGS scheme, SaxonJS in `@klopt/adapters` behind a port in core,
and two artefact versions loadable at once for a transition window. That is the
shape principle 6 asks for and the reason the artefacts are already in
`reference-data/`.

Seller details — address, KvK, VAT identifier, IBAN, electronic address — are
now columns on `entities`, all nullable, with a settings screen. Nullable
because an administration is a useful shadow ledger long before anybody invoices
out of it, and putting eleven fields in front of somebody on day one to satisfy
a rule they meet in month three is how a setup form becomes a wall. The UBL
generator refuses instead, naming the BT number of each field it is missing,
which is the moment they start to matter.
