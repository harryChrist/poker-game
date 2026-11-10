import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Arquivos estáticos servidos pelo próprio servidor:
 *  - "/"          -> jogo no navegador (build do apps/client, `npm run build:web`)
 *  - "/desktop/*" -> app desktop + version.json do auto-update (apps/desktop/release)
 * Os caminhos padrão são relativos a este arquivo (funciona tanto em src/ com tsx quanto no bundle dist/).
 */
const here = fileURLToPath(new URL('.', import.meta.url));
export const DEFAULT_PUBLIC_DIR = resolve(here, '../../client/dist');
export const DEFAULT_DESKTOP_DIR = resolve(here, '../../desktop/release');
/** Raiz do repositório (onde rodam git pull/build no deploy automático) */
export const REPO_DIR = resolve(here, '../../..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.txt': 'text/plain; charset=utf-8',
};

function fileIn(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null; // bloqueia ../
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

function send(req: IncomingMessage, res: ServerResponse, file: string, cache: string) {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = statSync(file).size;
  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/** Retorna true se respondeu a requisição */
export function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string, desktopDir: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = (req.url ?? '/').split('?')[0];

  if (path.startsWith('/desktop/')) {
    const file = fileIn(desktopDir, path.slice('/desktop/'.length));
    if (!file) return false;
    // version.json e o exe nunca podem ficar presos em cache (auto-update)
    send(req, res, file, 'no-cache');
    return true;
  }

  const file = path === '/' ? null : fileIn(publicDir, path);
  if (file) {
    // assets do Vite têm hash no nome: cache longo; o resto revalida
    const immutable = path.startsWith('/assets/');
    send(req, res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    return true;
  }
  // SPA: qualquer outra rota sem extensão cai no index.html
  if (!extname(path)) {
    const index = fileIn(publicDir, 'index.html');
    if (index) {
      send(req, res, index, 'no-cache');
      return true;
    }
  }
  return false;
}
