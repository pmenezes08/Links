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

/**
 * Vite plugin: preload the Font Awesome CSS chunk + the icon webfonts.
 *
 * Font Awesome is loaded via a runtime `import('@fortawesome/.../all.min.css')`
 * in main.tsx (kept non-blocking so #initial-loader paints immediately). The
 * downside: every icon glyph in the app (`<i class="fa-solid …">`) was gated
 * behind THREE sequential steps after a cold start — download+execute the JS
 * bundle, then fetch the FA CSS chunk, then fetch the woff2 webfont it points
 * at — so buttons rendered with blank icons for a noticeable beat.
 *
 * These `<link rel="preload">` hints let the browser fetch the FA CSS and the
 * dominant `fa-solid`/`fa-regular` fonts in PARALLEL with the JS bundle, from
 * the very first HTML parse. They do not block first paint (preload never
 * does), and the existing dynamic import still applies the stylesheet — now
 * straight from the preload cache. No inline `onload` handler, so no Android
 * WebView CSP issue. `fa-brands` (17 uses, 117 KB) is left to load on demand
 * so its weight never competes with the critical path on weak networks.
 *
 * Hashed filenames are read from the emitted bundle (serve mode has no bundle,
 * so this is a no-op in dev).
 */
function fontAwesomePreloadPlugin(): Plugin {
  let base = '/'
  return {
    name: 'fontawesome-preload',
    enforce: 'post',
    configResolved(config) {
      base = config.base || '/'
    },
    transformIndexHtml(html, ctx) {
      const bundle = ctx.bundle
      if (!bundle) return html
      let faCss: string | undefined
      const fonts: string[] = []
      for (const fileName of Object.keys(bundle)) {
        if (!faCss && /(?:^|\/)fontawesome-[\w-]+\.css$/.test(fileName)) {
          faCss = fileName
        } else if (/(?:^|\/)fa-(?:solid-900|regular-400)-[\w-]+\.woff2$/.test(fileName)) {
          fonts.push(fileName)
        }
      }
      const href = (fileName: string) => `${base}${fileName}`
      const tags: string[] = []
      if (faCss) {
        tags.push(`<link rel="preload" as="style" crossorigin href="${href(faCss)}">`)
      }
      for (const font of fonts) {
        tags.push(`<link rel="preload" as="font" type="font/woff2" crossorigin href="${href(font)}">`)
      }
      if (!tags.length) return html
      return html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), modulePreloadPlugin(), fontAwesomePreloadPlugin()],
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
