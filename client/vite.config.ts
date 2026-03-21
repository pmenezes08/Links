import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite plugin that transforms the built index.html to:
 * 1. Make CSS <link> tags non-render-blocking (paint #initial-loader immediately)
 * 2. Add <link rel="modulepreload"> for the main JS bundle
 */
function fastFirstPaintPlugin(): Plugin {
  return {
    name: 'fast-first-paint',
    enforce: 'post',
    transformIndexHtml(html) {
      let mainJs = ''

      // Replace render-blocking CSS with non-blocking media="print" pattern.
      // Stays in <head> (valid HTML, works on all WebViews including Android).
      // Browser downloads it without blocking paint, onload flips to media="all".
      const withAsyncCss = html
        .replace(
          /<link\s+rel="stylesheet"([^>]*?)href="([^"]+)"([^>]*)>/g,
          (_match, pre, href, post) =>
            `<link rel="stylesheet"${pre}href="${href}"${post} media="print" onload="this.media='all'">\n    <noscript><link rel="stylesheet" href="${href}"></noscript>`,
        )

      const jsMatch = withAsyncCss.match(/<script\s+type="module"[^>]*src="([^"]+)"/)
      if (jsMatch) mainJs = jsMatch[1]

      let result = withAsyncCss
      if (mainJs) {
        result = result.replace('</head>', `    <link rel="modulepreload" href="${mainJs}">\n  </head>`)
      }

      return result
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), fastFirstPaintPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Flask routes we call directly
      '/get_user_communities': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/upload_logo': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@fortawesome') || id.includes('fontawesome')) {
            return 'fontawesome'
          }
        },
      },
    },
  },
})
