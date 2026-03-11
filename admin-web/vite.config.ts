import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
      '/login': 'http://localhost:5000',
      '/login_password': 'http://localhost:5000',
      '/logout': 'http://localhost:5000',
      '/welcome_cards': 'http://localhost:5000',
      '/admin': 'http://localhost:5000',
    }
  }
})
