import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

/**
 * CI built-server e2e (`KLOPT_E2E_BUILT_SERVER=1` during `vite build` in shard
 * jobs) must keep `/lab/*` fixture routes. Those gates use `import.meta.env.DEV`,
 * which a normal production client/SSR bundle bakes as false. Overriding here is
 * CI-only test wiring, not a product escape hatch.
 */
const ciE2eBuiltBundle = process.env['KLOPT_E2E_BUILT_SERVER'] === '1'

export default defineConfig({
  ...(ciE2eBuiltBundle
    ? {
        define: {
          'import.meta.env.DEV': 'true',
          'import.meta.env.PROD': 'false',
        },
      }
    : {}),
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  // pdfkit loads its AFM fonts at runtime (createRequire + package imports);
  // bundled into _ssr it cannot find them, so keep it a real package.
  ssr: { external: ['pdfkit'] },
  plugins: [
    tailwindcss(),
    tanstackStart({ srcDirectory: 'src' }),
    viteReact(),
    /**
     * The headless gate (spec 10.1), as a Nitro *plugin* rather than a
     * configured middleware.
     *
     * Configured middleware is not first: Nitro unshifts its own public-asset
     * handler ahead of all of it, so a path in the client manifest was
     * answered before the gate ran — a 500 in the headless image, where those
     * files are absent. A plugin can reorder the chain after the app is built,
     * which is the only way to be genuinely in front. See the plugin, and
     * ADR 0056.
     */
    nitro({ plugins: ['./src/server-plugins/headless.ts'], traceDeps: ['pdfkit*'] }),
  ],
})
