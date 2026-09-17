# A Klopt module, in about sixty lines

This is the worked example for building on Klopt. It receives webhooks, checks
the signature, looks up the resource the event points at, and prints a line you
could send to a chat channel.

It is in this repository, and it is tested with the rest of the suite, but it
**imports no Klopt package**. That is enforced: `.dependency-cruiser.cjs` has a
rule called `examples-use-only-the-public-api`, and the build fails if this
directory reaches for `@klopt/anything`.

The reason is that an example importing the internals proves nothing. The
question it exists to answer is whether the published API and
`docs/api-stability.md` are enough to build on — and you cannot answer that
from inside. Notably, `src/verify.ts` reimplements signature checking from the
documentation rather than importing Klopt's copy: if the scheme cannot be
written in thirty lines from what is published, the documentation is wrong and
this is where that shows up.

## Running it

```sh
pnpm --filter @klopt/example-notifier build

KLOPT_URL=https://books.example.nl \
KLOPT_TOKEN=klopt_... \
KLOPT_WEBHOOK_SECRET=whsec_... \
node examples/notifier/dist/main.js
```

Then add `https://your-host/webhook` under **Webhooks** in Klopt, and paste the
signing secret it shows you once into `KLOPT_WEBHOOK_SECRET`.

The token needs `ledger:read` and nothing else. It fetches invoices; it does
not write anything, and it should not be able to.

## The four things worth copying

1. **Verify before you parse.** The signature is over the bytes that were sent.
   `JSON.parse` then `JSON.stringify` does not reproduce them.
2. **Refuse a stale timestamp.** The timestamp is inside the signed material so
   it cannot be moved, but a delivery captured an hour ago carries a perfectly
   valid signature. Acting on it twice is the point of capturing it.
3. **Answer 2xx for events you ignore.** Klopt's cursor only advances on a 2xx
   and delivery is ordered, so refusing a type you do not care about stops
   everything behind it.
4. **Do not throw on a type you have never seen.** New event types appear
   without warning — the stability promise says so explicitly — and a module
   that crashes on one breaks itself on somebody else's release.

## Behind NAT?

There is `GET /api/v1/events`, with the same events in the same order and a
cursor to resume from. Poll it instead; nothing above changes except where the
event comes from.
