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
      const cssLinks: string[] = []
      let mainJs = ''

      // Extract CSS link tags and main JS src
      const cleaned = html
        .replace(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_match, href) => {
          cssLinks.push(href)
          return '' // remove from <head>
        })

      // Find the main JS module script
      const jsMatch = cleaned.match(/<script\s+type="module"[^>]*src="([^"]+)"/)
      if (jsMatch) mainJs = jsMatch[1]

      // Build the async CSS loader + modulepreload to inject before </body>
      const preloads = cssLinks
        .map(href => `<link rel="preload" href="${href}" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${href}"></noscript>`)
        .join('\n    ')

      const modulepreload = mainJs
        ? `<link rel="modulepreload" href="${mainJs}">`
        : ''

      // Inject modulepreload in <head> and async CSS before </body>
      let result = cleaned
      if (modulepreload) {
        result = result.replace('</head>', `    ${modulepreload}\n  </head>`)
      }
      result = result.replace('</body>', `    ${preloads}\n  </body>`)

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
