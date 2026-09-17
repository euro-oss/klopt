/**
 * Schematron validation, as a port (spec 7.5).
 *
 * "Validate against the current schematron **before** send. Peppol BIS ships
 * releases roughly twice a year, so validation artefacts are versioned data
 * loaded at runtime, with the ability to run two versions during a transition
 * window."
 *
 * A port rather than an implementation in core for two reasons. Evaluating
 * Schematron needs an XML parser and an XPath engine, and core is meant to be
 * readable arithmetic and rules, not a machine for running someone else's
 * XSLT. And the choice of engine is genuinely open — the implementation that
 * ships is our own evaluator over an XPath 3.1 library, and a deployment that
 * would rather shell out to Saxon can supply that instead without core
 * knowing (ADR 0017).
 */

/** `fatal` fails the document. `warning` is reported and does not. */
export type SchematronSeverity = 'fatal' | 'warning'

export interface SchematronFailure {
  /** The official rule identifier: `BR-S-09`, `PEPPOL-EN16931-R003`, `NL-R-002`. */
  readonly rule: string
  /** The rule's own wording, verbatim from the artefact. */
  readonly message: string
  readonly severity: SchematronSeverity
  /** Where in the document, as a path a human can follow. */
  readonly location: string
  /** The XPath that failed, for anybody who needs to see why. */
  readonly test: string
  /** Which artefact the rule came from. */
  readonly artefact: string
}

export interface SchematronResult {
  /** True when nothing fatal fired. Warnings do not make a document invalid. */
  readonly valid: boolean
  readonly failures: readonly SchematronFailure[]
  readonly warnings: readonly SchematronFailure[]
  /** The artefacts that ran, so a result can say what it was judged against. */
  readonly artefacts: readonly string[]
  /** Rules evaluated, for the "did it actually run anything" question. */
  readonly assertionsEvaluated: number
}

export interface SchematronValidator {
  /** Validate a serialised XML document. Throws only if the XML is unparseable. */
  validate(xml: string): SchematronResult
}
