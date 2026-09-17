# 0025. On a purchase invoice the supplier is the authority, and booking precedes approval

Status: Accepted
Date: 2026-09-07

## Context

M4 is "Suppliers, purchase invoice inbox (email, PDF, UBL), approval flow,
inbound Peppol via adapter", and the milestone table says what it proves: "the
full cycle closes."

The obvious way to build it is sales with the signs flipped. That is wrong in
two ways, and both of them matter.

## The supplier states the figures; we verify them

On a sales invoice we are the authority on every number. We set the price, we
apply the rate, and the document we produce is correct by construction — which
is why `priceInvoice` computes the VAT and the operator never types it.

On a purchase invoice the supplier is the authority. Their document says what we
owe and what we may deduct. If their total is a cent off ours, **their total is
still what has to be paid**, and it is still what the VAT return has to reflect.
Silently replacing their figure with our arithmetic would make the books say
something the document does not — and the document is what an inspector reads.

So the purchase side records the stated net, VAT and total as given, and
`check.ts` classifies rather than corrects:

- **Blocking** — the capture is not the document. The lines do not sum to the
  stated net, or net plus VAT is not the stated total. Somebody mistyped or a
  line is missing, and what is in the system is not what is in the envelope.
- **Warning** — the capture is faithful and something is worth a look. The
  commonest by far is a rate that does not match, because suppliers round per
  line where we round per invoice and one line can cover two rates. The
  tolerance is a cent _per line_, because a warning that fires on every
  ordinary invoice is a warning nobody reads within a week.
- **Note** — neither. Usually that the VAT reaching rubriek 5b is smaller than
  the VAT on the paper, because the code is partly or wholly non-deductible.
  Said out loud so nobody reconciling the two has to work out why.

The screens follow from this. The entry form asks for the fields printed on the
document — number, net, VAT, total — and tells you when the lines disagree with
them. There is a button that fills a line's VAT from its tax code, and it only
ever fires on request: a field that helpfully overwrote itself with our
arithmetic would defeat the whole point.

**The one exception is a duplicate.** It is refused at capture rather than saved
with a finding, because the unique index on (entity, supplier, number) cannot
hold two — and it should not. Paying an invoice twice is the classic
accounts-payable failure, and the supplier's own numbering is the only thing
that identifies a document across two arrivals of it: by email and then by post,
or over Peppol and then as a PDF chase. Telling somebody "you already entered
this" beats saving a second copy for them to cancel.

## Booking happens on receipt; approval gates payment

An invoice that has arrived is a liability whether anybody has authorised it,
and the VAT on it is deductible in the period of the _invoice date_ — which may
well be closed by the time an approver gets to it. Posting only on approval
would mean a late deduction or a suppletie every time somebody went on holiday.

So the states are:

```
draft ──book──▶ booked ──approve──▶ approved ──▶ (paid, via a batch)
                   │                    │
                   ├──dispute──▶ disputed ──resolve──▶ booked
                   │
cancelled ◀──cancel┘ (draft only; a booked invoice is reversed instead)
```

The booking date defaults to the invoice's own date, which is the answer that
needs no thought, with an override for the January invoice that turns up in
April — the operator, not the handler, decides whether that becomes a suppletie
or a current-period booking.

A `disputed` invoice **stays booked**. The liability is real until it is settled
or credited, and leaving disputed amounts out of the creditors ageing would
understate what is outstanding by exactly the sums somebody is arguing about.
What it cannot do is be paid.

Resolving a dispute returns to `booked`, not to `approved`: an authorisation
given before the problem was known does not survive it, so `approved_by` is
cleared and somebody has to look again.

Cancelling is a draft-only action. Withdrawing a booking is a reversal, per the
correction doctrine — nothing in the journal is ever edited.

## Self-approval is allowed here and not on a payment file

`purchase:approve` is its own permission, held by the owner and the accountant
and not by the bookkeeper: entering a cost and authorising it are different acts
and the person doing a hundred of the first should not be the only check on the
second.

But unlike ADR 0020's payment batch, approving one's own purchase invoice is
allowed. The two-person control that matters stands between the books and the
bank, and it is already there — a payment file needs a second person whatever
the invoice says. Demanding one here as well would leave a one-person BV unable
to authorise any cost at all, which is not a control; it is a product that does
not work for its commonest user.

What _is_ refused is approval by a script. The point of an authorisation is that
somebody looked, and a scheduled job that approves whatever arrives is not
somebody looking. A human working through the API with a token is fine.

## Where M3 and M4 interlock

The posting is where the tax code rule from ADR 0021 earns its keep.

**Non-deductible VAT is not VAT any more; it is cost.** So it goes to the
expense account on its own line, next to the base rather than folded into it.
Two lines on one account is exactly what the base/tax tagging made possible, and
it is what keeps the auditfile honest about which euros were the base and which
were VAT that turned into a cost. The line is untagged, because tagging it would
put it in rubriek 5b.

**A reverse charge posts VAT the supplier never charged.** Under an
intra-community acquisition or article 23 deferment the invoice carries no VAT
and we owe it ourselves, so the entry credits the payable account under the
acquisition code — putting it in 4b or 2a — and debits the receivable one under
the _paired_ `deductionCode`, putting the same money in 5b. One code cannot
declare the same euros as both owed and deductible, which is why the pair exists
and why a self-assessing code without one is refused rather than losing the VAT
quietly.

Costs collapse per account **and** tax code, for the same reason revenue does:
two rates on one expense account collapsed together are two deductions nothing
downstream can separate.

## Consequences

- **The inbox is not here yet.** Spec 6 wants "a purchase-invoice inbox that
  ingests email, PDF and Peppol UBL into the same queue", and §7.5 wants inbound
  UBL parsed into a draft with the original XML attached. This milestone builds
  the invoice and its flow; the inbox is the next slice, and it produces drafts
  through the same capture path.
- **A payment batch does not yet draw from approved invoices.** The tables are
  here — `payment_instruction_invoices` links an instruction to the invoices it
  settles, and the open-items query already counts both it and bank
  allocations — but nothing populates it. "Pay these approved invoices" is the
  obvious next step and it is what closes the cycle in fact rather than in
  principle.
- **Contacts gained an IBAN field**, which they should have had in M2: a
  supplier whose bank details cannot be recorded is a supplier who has to be
  retyped into every payment run. Found by a browser test looking for a field
  that was not there.

## Two things this work turned up

**A raw NUL byte in three source files.** `dimensionKey` in `ledger/ports.ts`
used a literal `\0` as a map-key separator — a sound design, written as a raw
byte instead of the `�` escape. The consequence is that `grep` treats the
file as binary and silently reports nothing, which had already sent one search
down a blind alley; a second copy reached a SQL parameter and Postgres refused
it with "invalid byte sequence for encoding UTF8". All three are now escapes,
which behave identically and leave the files searchable.

**A payment file whose bytes changed between downloads.** `generatePain001`
stamped `CreDtTm` from the clock at second precision, so downloading the same
approved batch twice produced two different files — and the handler test
comparing their hashes passed or failed depending on whether the two calls
straddled a second. That is not a flaky test; it is a broken guarantee, because
the evidence chain records the hash of what went to the bank and "store the
exact bytes sent" cannot be said of bytes that change. `CreDtTm` now comes from
the batch's approval, which is the moment the file became final and is exactly
what the element means.
