# 0048. An import report a script can read

Status: Accepted
Date: 2026-09-14

## Context

`XafProblem` was the last thing in the codebase that said what was wrong only
in prose:

```ts
export interface XafProblem {
  readonly severity: XafProblemSeverity
  readonly path: string
  readonly message: string
}
```

Two consequences, and the second is the one that mattered less but is worth
more. It could not be translated, which is why ADR 0047's `forwarded()` kept a
`null` branch. And **an integrator could not branch on it** — a script driving
`import.auditFile` could tell that a file failed but not whether it failed
because it does not balance or because an account is declared twice, and those
call for different handling.

Every other refusal in this system has a code, for exactly that reason.
`LedgerErrorCode` since M0, the finding codes since M2. This one was missed
because it is produced by a validator rather than by the domain, and validators
feel like they only talk to people.

They do not. `handleExportAuditFile` was flattening all of them to a single
`xaf_invalid`, which is the shape of the problem showing through.

## Nineteen codes, twenty sentences

`XafProblemCode` covers what the validator can find: a field over the schema's
length limit, a date that is not a date, a reversed period, a duplicate
account, journal or transaction number, a reference to an account, party or VAT
code that is not in the file, a transaction with no lines, a negative amount,
and the three ways the arithmetic can fail — a transaction, the file, or the
opening balance.

Twenty message keys rather than nineteen, because "references unknown account"
is raised from four places with the same sentence and one key, while "unknown
account" for a journal's offset account is a different sentence and gets its
own. The sentence and the code are separate things, which is ADR 0046's whole
argument arriving here too.

The messages went into `FINDING_MESSAGES` rather than a fourth catalogue. An
XAF problem is a finding — something a check found, advisory or blocking — and
the only thing that had made it different was the missing code.

## Consequences

- `forwarded()` has no callers passing `null` any more. Every violation in the
  system now names its sentence, so every one of them translates. The `null`
  branch stays in the signature for the next source that has no code, which is
  cheaper than removing it and adding it back.
- `import.auditFile` reports the real code instead of `xaf_invalid`. That is a
  new value in an existing field rather than a new field: `docs/api-stability.md`
  says a consumer must treat an unknown code as a generic failure of that
  status, which is what this needs from them.
- 818 core tests passed unchanged, including the RGS warning whose message is
  built from a slice and a join and had to be rewritten by hand.
- The translation work that started with ADR 0038 is finished. Every sentence
  this product shows a user — chrome, computed labels, refusals, findings, and
  now import problems — is in the reader's language, and each layer has a test
  that fails when a new one is added untranslated.
