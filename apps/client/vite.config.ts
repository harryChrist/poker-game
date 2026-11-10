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

/**
 * Id único de cada build. Vai embutido no JS (__BUILD_ID__) e em dist/build.json; o servidor lê o build.json
 * e manda no 'server:hello' — se for diferente do do cliente, a página recarrega (deploy novo).
 */
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function buildInfo(): Plugin {
  return {
    name: 'cards-build-info',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ id: BUILD_ID, at: new Date().toISOString() }) });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), devCsp(), buildInfo()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
