/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // C-Point design-system tokens. Mirror the CSS custom properties
        // declared in `client/src/index.css` :root (see docs/DESIGN.md
        // § Color). Turquoise is the primary accent; legacy `#4db6ac`
        // surfaces are being backfilled to this token.
        cpoint: {
          turquoise: '#00CEC8',
          bgApp: '#000000',
          white: '#FFFFFF',
          blackMarketing: '#0F172A',
        },
        // Semantic theme tokens (wired to CSS vars for light/dark switching)
        c: {
          bg: {
            app: 'var(--c-bg-app)',
            elevated: 'var(--c-bg-elevated)',
            surface: 'var(--c-bg-surface)',
            recessed: 'var(--c-bg-recessed)',
            overlay: 'var(--c-bg-overlay)',
            reply: 'var(--c-reply-snippet-bg)',
          },
          header: {
            bg: 'var(--c-header-bg)',
          },
          nav: {
            bg: 'var(--c-nav-bg)',
            text: 'var(--c-nav-text)',
          },
          composer: {
            bg: 'var(--c-composer-bg)',
            input: 'var(--c-composer-input-bg)',
          },
          text: {
            primary: 'var(--c-text-primary)',
            secondary: 'var(--c-text-secondary)',
            tertiary: 'var(--c-text-tertiary)',
            disabled: 'var(--c-text-disabled)',
            link: 'var(--c-text-link)',
            'on-accent': 'var(--c-text-on-accent)',
          },
          border: {
            DEFAULT: 'var(--c-border-default)',
            subtle: 'var(--c-border-subtle)',
            strong: 'var(--c-border-strong)',
            accent: 'var(--c-border-accent)',
          },
          accent: {
            DEFAULT: 'var(--c-accent)',
            hover: 'var(--c-accent-hover)',
            active: 'var(--c-accent-active)',
            muted: 'var(--c-accent-muted)',
            ink: 'var(--c-accent-ink)',
          },
          hover: {
            bg: 'var(--c-hover-bg)',
            accent: 'var(--c-hover-accent)',
          },
          active: {
            bg: 'var(--c-active-bg)',
            accent: 'var(--c-active-accent)',
          },
          skeleton: {
            strong: 'var(--c-skeleton-strong)',
            subtle: 'var(--c-skeleton-subtle)',
          },
        },
      },
      boxShadow: {
        'c-glass': 'var(--c-glass-shadow)',
        'c-focus': 'var(--c-focus-ring)',
        'c-card': 'var(--c-shadow-card)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
}

