import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // pg exposes pg-native as an optional dependency. Bundling pg makes
              // Vite turn that optional import into an unconditional runtime error.
              // ethernet-ip is kept external as well: it is a runtime dependency
              // resolved from node_modules by the Electron main process.
              external: ['pg', 'ethernet-ip']
            }
          }
        }
      },
      preload: { input: 'electron/preload.ts' }
    })
  ]
})
