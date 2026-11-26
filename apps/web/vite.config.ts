import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

if (process.env['KLOPT_E2E_BUILT_SERVER'] === '1' && process.env['CI'] !== 'true') {
  throw new Error(
    'Refusing vite build: KLOPT_E2E_BUILT_SERVER=1 is only allowed in CI (set CI=true). This flag enables /lab e2e fixture routes in the bundle.',
  )
}

export default defineConfig({
  define: {
    __KLOPT_LAB_ROUTES__: JSON.stringify(process.env['KLOPT_E2E_BUILT_SERVER'] === '1'),
  },
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
    nitro({ plugins: ['./src/server-plugins/http-gates.ts'], traceDeps: ['pdfkit*'] }),
  ],
})
