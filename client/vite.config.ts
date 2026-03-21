import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite plugin: add modulepreload hint for the main JS bundle.
 * CSS stays as a normal render-blocking <link> — at ~13 KB gzipped it loads
 * in <50 ms and avoids Android WebView CSP issues with inline onload handlers
 * and the layout shift caused by async CSS application.
 */
function modulePreloadPlugin(): Plugin {
  return {
    name: 'module-preload',
    enforce: 'post',
    transformIndexHtml(html) {
      const jsMatch = html.match(/<script\s+type="module"[^>]*src="([^"]+)"/)
      if (jsMatch) {
        return html.replace('</head>', `    <link rel="modulepreload" href="${jsMatch[1]}">\n  </head>`)
      }
      return html
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), modulePreloadPlugin()],
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
