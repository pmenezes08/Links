/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#4db6ac',
        muted: '#9fb0b5',
        surface: '#111111',
        'surface-2': '#1a1a1a',
      }
    }
  },
  plugins: [],
}
