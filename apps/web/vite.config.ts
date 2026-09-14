import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: 'src' }),
    viteReact(),
    /**
     * The headless gate (spec 10.1), as Nitro middleware because a route-level
     * check would only ever see the routes this build happens to have.
     *
     * Not quite every request, though. Nitro composes its own public-asset
     * middleware ahead of ours, so a request for a path the asset manifest
     * knows is answered before this runs — which in the headless image, where
     * the files are absent, is an ENOENT rather than a refusal. ADR 0042
     * records why that is a wart worth having rather than one worth fixing
     * with a private field.
     *
     * `route` is there only because `NitroEventHandler` marks it required.
     * Nitro's own check is `h.middleware || !h.route`, so this stays global
     * middleware either way — verified by the generated `globalMiddleware`
     * line being identical with and without it.
     */
    nitro({
      handlers: [
        { route: '/**', middleware: true, handler: './src/server-middleware/headless.ts' },
      ],
    }),
  ],
})
