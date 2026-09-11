# 0041. A module contract with teeth

Status: Accepted
Date: 2026-09-11

## Context

Spec 9.5, the fifth of the ERP-ready seams:

> **A module contract.** A module declares: its tables in its own schema, the
> domain events it emits and consumes, its posting rules, and its permissions.
> Enforce it from the first module you write, which should be Sales, so the
> contract is real and not aspirational.

The last clause is the requirement. A contract nothing checks is a paragraph
in a README that stops being true in month six, and nobody finds out until a
second module writes to `sales_invoices` because it was quicker than asking.

## The declaration is data, in one place

`packages/core/src/modules/contract.ts` holds one list: nine modules, each
declaring its tables, the events it emits and consumes, where it posts, and
which permissions it needs.

In `core` rather than distributed across the modules, deliberately. A module
cannot be trusted to declare itself in a file only it reads, and the value of
the map is that a reviewer can hold the whole of it in their head at once.
Nine entries fits on a screen; nine files do not.

## What the test enforces, and what it does not

`packages/db/test/modules.test.ts` reads the actual schema source and compares:

- **Every table is claimed by exactly one module.** A new table with no owner
  fails the build, and the failure names the table and the file to add it to.
  This is the property that rots — the others follow from it.
- **No table is claimed twice**, and **no module claims a table that no longer
  exists**. The second catches the lie a rename leaves behind.
- **Events are in the catalogue**, both directions, and **no catalogue entry
  has nobody to emit it** — which would be either a dead name a consumer waits
  on forever or an emit somebody forgot to declare.
- **Permissions exist.**

It deliberately does **not** enforce that a module only _writes_ its own
tables. Postgres could, with a role and a grant matrix per module; that means a
connection per module and a privilege table, which is a great deal of machinery
to defend a boundary that one grep and one code review already defend. The
declaration makes the intent checkable by a human; the ownership test keeps the
map honest. Those are the two halves worth having today.

## What the exercise found

Writing the map is a review of the architecture, which is most of its value.
Three things it settled:

- **Contacts belong to the kernel, not to Sales.** Spec 9.4 calls documents and
  parties shared kernels; the map is where that stops being a sentence. Sales
  _uses_ `contacts` and a purchase invoice points at the same row, so neither
  owns it. Had Sales claimed it, `purchase` would have had to claim it too and
  the clash test would have said so.
- **The inbox belongs to Purchase.** It looked like a kernel concern — anything
  can arrive — but everything that arrives becomes a purchase invoice or is set
  aside, and no other module reads it.
- **`platform` is the only module with a non-empty `consumes`.** It is the
  reason that field exists on the interface at all, and having exactly one
  honest user of it is better than nine empty arrays pretending at symmetry.

## Consequences

- **Adding a table now requires a decision about who owns it.** That is the
  point, and it costs one line.
- **`access` lists better-auth's tables** rather than exempting them. A
  category of unowned tables is a hole you could drive a module through.
- **The register is not a plugin system.** Nothing loads modules at runtime and
  nothing is dynamically registered; these are the parts of one application,
  described honestly. If a genuinely external module ever wants in, it arrives
  through the API and the event stream — which is what `docs/api-stability.md`
  is a promise about — and the question of loading foreign code into this
  process is one to answer then, on purpose, rather than by having left a
  plugin loader lying around.
