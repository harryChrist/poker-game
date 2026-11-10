import { DEFAULT_DESKTOP_DIR, DEFAULT_PUBLIC_DIR, REPO_DIR } from './static';
import { deployConfigFromEnv, type DeployConfig } from './deploy';
export interface Config {
  port: number;
  dbPath: string;
  startBalance: number;
  refillTo: number;
  refillThreshold: number;
  refillCooldownMin: number;
  dailyBonus: number;
  /** Intervalo do bônus (minutos). Padrão 60 = de hora em hora. */
  bonusIntervalMin: number;
  adminUsernames: string[];
  /** Build web do jogo servido em / */
  publicDir: string;
  /** Arquivos do app desktop + version.json (auto-update) servidos em /desktop/ */
  desktopDir: string;
  /** Webhook de deploy automático (null = desligado, ver deploy.ts) */
  deploy: DeployConfig | null;
}

function int(v: string | undefined, def: number, min = 0): number {
  if (v === undefined || v.trim() === '') return def;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : def;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: int(env.PORT, 4080, 1),
    dbPath: env.DB_PATH && env.DB_PATH.trim() ? env.DB_PATH.trim() : './data/cartas.db',
    startBalance: int(env.START_BALANCE, 10_000),
    refillTo: int(env.REFILL_TO, 10_000),
    refillThreshold: int(env.REFILL_THRESHOLD, 1_000),
    refillCooldownMin: int(env.REFILL_COOLDOWN_MIN, 10),
    dailyBonus: int(env.DAILY_BONUS, 1_000),
    bonusIntervalMin: int(env.BONUS_INTERVAL_MIN, 60, 1),
    adminUsernames: (env.ADMIN_USERNAMES ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    publicDir: env.PUBLIC_DIR?.trim() || DEFAULT_PUBLIC_DIR,
    desktopDir: env.DESKTOP_DIR?.trim() || DEFAULT_DESKTOP_DIR,
    deploy: deployConfigFromEnv(env, REPO_DIR),
  };
}

export const TEST_CONFIG: Config = {
  port: 0,
  dbPath: ':memory:',
  startBalance: 10_000,
  refillTo: 10_000,
  refillThreshold: 1_000,
  refillCooldownMin: 10,
  dailyBonus: 1_000,
  bonusIntervalMin: 60,
  adminUsernames: [],
  publicDir: DEFAULT_PUBLIC_DIR,
  desktopDir: DEFAULT_DESKTOP_DIR,
  deploy: null,
};

/** Erro com mensagem segura para mostrar ao usuário (vai no ack). */
export class UserError extends Error {}

export function fail(msg: string): never {
  throw new UserError(msg);
}
