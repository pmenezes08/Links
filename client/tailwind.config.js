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
        // § Color). Turquoise is the primary accent for new work; legacy
        // `#4db6ac` surfaces will be backfilled in a separate phase.
        cpoint: {
          turquoise: '#00CEC8',
          bgApp: '#000000',
          white: '#FFFFFF',
          blackMarketing: '#0F172A',
        },
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

