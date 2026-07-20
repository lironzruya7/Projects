import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_PORT = process.env.PORT || '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
