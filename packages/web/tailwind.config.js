/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0f172a',
        panel: '#1e293b',
        panel2: '#243449',
        edge: '#334155',
        ink: '#e2e8f0',
        muted: '#94a3b8',
        brand: '#38bdf8',
      },
    },
  },
  plugins: [],
};
