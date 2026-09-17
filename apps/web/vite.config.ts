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
    nitro({ plugins: ['./src/server-plugins/headless.ts'] }),
  ],
})
