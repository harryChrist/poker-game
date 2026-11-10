import { ENGINES } from '@cards/games';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp({ config, engines: ENGINES });

app
  .listen()
  .then((port) => console.log(`[server] Mesa de Cartas ouvindo na porta ${port} (db: ${config.dbPath})`))
  .catch((e) => {
    console.error('[server] não foi possível iniciar', e);
    process.exit(1);
  });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recebido: devolvendo fichas e encerrando...`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    await app.close();
  } catch (e) {
    console.error('[server] erro no encerramento', e);
  }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('[server] uncaughtException', e));
