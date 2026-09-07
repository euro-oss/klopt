# 0017. The schematron runs in process, as data, on an XPath 3.1 engine

Status: Accepted
Date: 2026-09-07

Supersedes the deferral in [0016](0016-ubl-generation-before-schematron.md).

## Context

[0016](0016-ubl-generation-before-schematron.md) shipped UBL generation and
deferred the schematron pass, with nothing able to send until it arrived. This
is that arrival.

The Peppol BIS and NLCIUS rules ship as ISO Schematron with XSLT 2.0 inside
them — `xs:decimal`, `every … satisfies`, `string-to-codepoints`, and thirteen
`xsl:function` declarations doing GLN check digits, mod-11, mod-97 and Luhn.
OpenPeppol publishes no compiled artefacts. So running the official rules needs
an XPath 2.0-or-better engine, and there were three ways to get one:

**SaxonJS.** Runs the artefacts verbatim, pure Node, no JVM — and proprietary.
Its licence is not OSI-approved, forbids reverse engineering, and restricts
"copying the software to a site whose primary purpose is to make it available to
third parties". In an Apache-2.0 repository intended to be packaged by others,
that is a dependency Debian and Nix will refuse, sitting inside a project whose
first principle is about not being locked in.

**Java Saxon-HE with ph-schematron.** Genuinely open source, runs the artefacts
verbatim, and is what every serious Peppol implementation does. The cost is a
JVM in the container, against principle 5's "one container, Postgres, S3".

**Our own evaluator over an XPath 3.1 library.** No JVM, everything permissive,
and the artefacts stay as `.sch` files loaded at runtime. The cost is that
Schematron's semantics and the thirteen functions become our problem.

## Decision

**The third.** `@klopt/adapters/schematron` is an ISO Schematron evaluator over
`fontoxpath` (MIT), with `slimdom` (MIT) for the DOM. It parses the published
`.sch` and evaluates it. Nothing is compiled ahead of time and nothing generated
is committed: a BIS release is a new file in `reference-data/peppol/` and a
restart, which is what principle 6 asks for and is _more_ literally true here
than a compiled-artefact pipeline would be.

The divergence risk is real and is managed rather than waved away:

- **The functions are translated, not reimplemented.** An `xsl:function` is
  `param* variable* (sequence | choose)`, which is exactly an XPath 3.1
  `let … return` chain with `if … then … else`. The mod-97 arithmetic that
  decides whether a company number is valid stays the arithmetic CEN published.
  A translation of thirteen functions is reviewable; thirteen reimplementations
  are not.
- **The semantics that are easy to get wrong are tested directly.** A rule's
  `@context` is a match pattern, not a path — `cac:TaxSubtotal` means "anywhere",
  and evaluating it as written finds nothing. Within a pattern the _first_
  matching rule claims a node and later rules never see it; ignoring that
  produces a flood of failures from rules meant as fallbacks. Both have their
  own tests, on synthetic schemas, independent of any artefact.
- **The three golden UBL files are validated against the real artefacts in CI**,
  and six deliberately broken variants assert that the official rule identifier
  comes back. One of them, `BR-CL-14`, is a code-list rule that no hand-written
  check would have had: it is the evidence that running the artefact buys
  something over the pre-flight subset.

Parsing both artefacts costs about 240 ms once; validating a document about
100 ms warm. Both are cached at the process level.

`SchematronValidator` is a port in `@klopt/core` and the evaluator is an
adapter, so a deployment that would rather shell out to Saxon can, and core
never learns which.

## Consequences

Nothing leaves `GET /api/v1/sales-invoices/{id}/ubl` that has not passed the
published Peppol BIS 3.0 and NLCIUS rules. That is the guarantee 0016 deferred,
and it is what makes a transport safe to build next.

**Two validation layers stay, on purpose** — the pattern from
[0012](0012-xaf-two-layer-validation.md). `checkUblRules` runs on the document
before it is generated and names the _field_ (`seller.address`), which is what a
settings form can point at. The schematron runs on the bytes afterwards and is
the authority. Doing only the first ships documents that fail at the far end;
doing only the second tells a bookkeeper their invoice violates
`/Invoice/cac:AccountingSupplierParty/cac:Party` and leaves them to guess which
box to type in.

The obligation this takes on: **when a BIS release adds a Schematron construct
we do not implement, loading it must fail loudly rather than skip it.** The
parser throws on anything it cannot translate — an `xsl:choose` without an
`otherwise`, a function body it does not recognise — rather than returning fewer
rules. A validator that silently checks less is the one failure mode that would
make this decision the wrong one, and it is the one the design refuses.

`<sch:include>`, `<sch:phase>` selection and `<sch:report>` are not implemented,
because the artefacts do not use them. They are absent rather than stubbed, for
the same reason.
