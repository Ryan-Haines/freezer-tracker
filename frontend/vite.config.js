import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    // Add your Tailscale hostname here if accessing over tailnet
    // allowedHosts: ['your-machine.your-tailnet.ts.net'],
    proxy: {
      '/api': {
        target: 'http://backend:8001',
        changeOrigin: true
      }
    }
  }
})
