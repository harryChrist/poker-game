import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Deploy automático via webhook do GitHub.
 *
 * GitHub (Settings → Webhooks): Payload URL = https://cardgame.hchrist.com/api/deploy/github,
 * Content type = application/json, Secret = DEPLOY_WEBHOOK_SECRET, evento "push".
 * A cada push no branch DEPLOY_BRANCH (padrão main) o servidor roda DEPLOY_COMMAND
 * (padrão: bash scripts/deploy.sh) em segundo plano: git pull, npm install, build e pm2 reload.
 * Sem DEPLOY_WEBHOOK_SECRET a rota não existe (404).
 */
export interface DeployConfig {
  secret: string;
  branch: string;
  command: string;
  /** Raiz do repositório (cwd do comando) */
  repoDir: string;
  logFile: string;
}

export const WEBHOOK_PATH = '/api/deploy/github';
const MAX_BODY = 5 * 1024 * 1024;

let running = false;
let queued = false;

function verify(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(body).digest('hex'));
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function runDeploy(cfg: DeployConfig, log: (msg: string) => void) {
  if (running) {
    queued = true; // chegou outro push no meio: roda de novo no fim
    return;
  }
  running = true;
  mkdirSync(dirname(cfg.logFile), { recursive: true });
  const out = openSync(cfg.logFile, 'a');
  log(`deploy: iniciando "${cfg.command}" (log em ${cfg.logFile})`);
  // detached: o script reinicia o próprio servidor (pm2 reload) e precisa sobreviver a isso
  const child = spawn(cfg.command, { cwd: cfg.repoDir, shell: true, detached: true, stdio: ['ignore', out, out] });
  child.on('exit', (code) => {
    running = false;
    log(`deploy: terminou com código ${code}`);
    if (queued) {
      queued = false;
      runDeploy(cfg, log);
    }
  });
  child.on('error', (e) => {
    running = false;
    log(`deploy: falhou ao iniciar: ${e.message}`);
  });
  child.unref();
}

/** Retorna true se a requisição era do webhook (respondida aqui) */
export function handleDeployWebhook(
  req: IncomingMessage, res: ServerResponse, cfg: DeployConfig | null, log: (msg: string) => void,
): boolean {
  if ((req.url ?? '').split('?')[0] !== WEBHOOK_PATH) return false;
  const reply = (code: number, text: string) => {
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
  };
  if (!cfg) {
    reply(404, 'não encontrado');
    return true;
  }
  if (req.method !== 'POST') {
    reply(405, 'use POST');
    return true;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sig = req.headers['x-hub-signature-256'];
    if (!verify(cfg.secret, body, Array.isArray(sig) ? sig[0] : sig)) {
      log('deploy: assinatura inválida recusada');
      reply(401, 'assinatura inválida');
      return;
    }
    const event = req.headers['x-github-event'];
    if (event === 'ping') {
      reply(200, 'pong');
      return;
    }
    if (event !== 'push') {
      reply(202, `evento ${String(event)} ignorado`);
      return;
    }
    let ref = '';
    try {
      ref = String(JSON.parse(body.toString('utf8')).ref ?? '');
    } catch {
      reply(400, 'json inválido');
      return;
    }
    if (ref !== `refs/heads/${cfg.branch}`) {
      reply(202, `push em ${ref} ignorado`);
      return;
    }
    reply(202, 'deploy iniciado');
    runDeploy(cfg, log);
  });
  return true;
}

/** Monta a config a partir do env (null = webhook desligado) */
export function deployConfigFromEnv(env: Record<string, string | undefined>, repoDir: string): DeployConfig | null {
  const secret = env.DEPLOY_WEBHOOK_SECRET?.trim();
  if (!secret) return null;
  return {
    secret,
    branch: env.DEPLOY_BRANCH?.trim() || 'main',
    // setsid -f: o script sai da árvore de processos do servidor (o pm2 reload não o derruba no meio)
    command: env.DEPLOY_COMMAND?.trim() || (process.platform === 'win32' ? 'bash scripts/deploy.sh' : 'setsid -f bash scripts/deploy.sh'),
    repoDir,
    logFile: resolve(repoDir, env.DEPLOY_LOG?.trim() || 'data/deploy.log'),
  };
}

/** Id do build da web app (gerado pelo Vite em dist/build.json). Os clientes recarregam se ele mudar. */
export function readBuildId(publicDir: string): string | null {
  try {
    return String(JSON.parse(readFileSync(join(publicDir, 'build.json'), 'utf8')).id ?? '') || null;
  } catch {
    return null;
  }
}
