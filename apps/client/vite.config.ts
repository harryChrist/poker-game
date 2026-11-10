import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * O index.html carrega a CSP estrita (produção). No dev server o plugin do React injeta um script inline
 * (react-refresh), então só em `serve` liberamos 'unsafe-inline' para scripts.
 */
function devCsp(): Plugin {
  return {
    name: 'cards-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline';");
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), devCsp()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
