/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic surface/text tokens driven by CSS variables, so the whole app
        // re-themes (light ⇄ dark) by swapping the variable set on <html>. Stored
        // as raw "R G B" channels so Tailwind's /alpha syntax keeps working
        // (e.g. bg-panel/50, bg-surface/90).
        surface: 'rgb(var(--surface) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        panel2: 'rgb(var(--panel2) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        brandink: 'rgb(var(--brand-ink) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
