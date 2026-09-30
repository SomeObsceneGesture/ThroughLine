import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Strict Content-Security-Policy for production builds (the dev server needs
// inline scripts for hot reload, so it is only injected at build time).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' loupe: data: blob:",
  "media-src 'self' loupe: blob:",
  "font-src 'self' data:",
  "connect-src 'self' loupe:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function csp(): Plugin {
  return {
    name: 'loupe-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
}

const shared = { '@shared': resolve('src/shared') }

export default defineConfig(({ command }) => ({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'media-worker': resolve('src/main/workers/media-worker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), csp()],
    // electron-vite leaves the renderer unminified by default; ship React's
    // production build, minified.
    define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : undefined,
    build: { target: 'chrome140', chunkSizeWarningLimit: 2000, minify: 'esbuild' }
  }
}))
