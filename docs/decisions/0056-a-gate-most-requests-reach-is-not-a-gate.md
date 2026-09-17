# 0056. A gate most requests reach is not a gate

Status: Accepted
Date: 2026-09-17
Amends: ADR 0042

## Context

ADR 0042 recorded a wart. In the headless image, a request for a path in the
client asset manifest got a 500 and a stack trace instead of the mode's 404
problem document, because Nitro's public-asset middleware ran first and the
files it went looking for were not in the image. The note said it was
reachable only by somebody holding an asset URL from a different instance, and
left it.

That was the right call at the time and it is the wrong shape to keep. The
reason is not the blast radius — it is what it says about the mode. `--headless`
means "no web app mounted"; if the framework answers a few hundred paths before
the gate runs, the mode is a convention over a full install, which is exactly
what the middleware's own comment says it must not be.

## Configured middleware is not first

The gate was registered as `nitro({ handlers: [{ route: '/**', middleware:
true, … }] })`, which produces _global middleware_ — a name that sounds like
"runs before everything" and does not mean it. Nitro assembles the chain and
then `unshift`s its static handler ahead of every configured entry,
unconditionally, whenever `serveStatic` is on.

There is no configuration order that gets in front of it. `serveStatic: false`
does, by deleting the static handler, but the same build produces the full
image, which needs it.

## A plugin, because a plugin is the supported way to reorder

Nitro calls plugins with the built app and clears the composed chain
immediately afterwards. So a plugin can put the gate at the head of
`h3App['~middleware']` and Nitro recomposes around it. That is the extension
point doing its job rather than a reach into a private field that happens to
work — plugins exist to mutate the app, and the reset on the next line is
Nitro expecting exactly that.

The gate is now the first thing any request meets. `/assets/whatever.js`
against a headless instance is the same problem document as `/sales/invoices`,
in the full image the assets are served unchanged, and a genuinely missing
asset in the full image is still Nitro's own 404.

## The part that is only true of the built server

`unshift` putting an element at index 0 is not in doubt. What the change
actually rests on is that Nitro _calls the plugin_, and that the static handler
has left the configured list — neither of which any amount of reading the
config settles.

So there are two tests: one on the plugin over a fake app, and one that reads
the generated server bundle and asserts both facts. The second treats
`.output/server/index.mjs` as a build product the suite depends on, like
`routeTree.gen.ts`; `pnpm run verify` builds before it tests, and the
assertion says so when it does not.

## Consequences

- One wart from ADR 0042 is closed. The other — the headless server bundle
  still carrying SSR code for routes nothing can reach, because the TanStack
  Start plugin accepts and ignores `routeFileIgnorePattern` — is untouched and
  still upstream.
- `src/server-plugins/` exists, with one file in it. Anything else that has to
  be in front of the framework belongs there and nowhere else.
- The bundle assertion is coupled to Nitro's generated output, so a Nitro
  upgrade that renames `~middleware` fails this test. That is the point: the
  arrangement depends on that shape, and finding out at build time beats
  finding out from a 500 in somebody's headless deployment.
