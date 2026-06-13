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
          if (id.includes('node_modules')) {
            // Split stable vendor libs into their own chunks so they stay
            // service-worker-cached across app-code deploys (the app chunk
            // changes, vendors don't) and download in parallel on first load.
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor'
            }
            if (id.includes('@capacitor')) return 'capacitor'
            if (id.includes('@tanstack')) return 'tanstack'
            if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n'
            return 'vendor'
          }
        },
      },
    },
  },
})
