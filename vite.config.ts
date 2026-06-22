import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart({
      importProtection: {
        enabled: false,
      },
      serverFns: {
        generateFunctionId: ({ filename, functionName }) => {
          const file = filename
            .replace(/^.*\/src\//, '')
            .replace(/\.\w+$/, '')
            .replace(/\//g, '.')
          const fn = functionName.replace(/_createServerFn_handler$/, '')
          return `${file}.${fn}`
        },
      },
    }),
    viteReact(),
  ],
})
