import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Role } from '@cards/shared';
import { fail } from './config';
import type { Wallet, UserRow } from './wallet';

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Limitador simples de tentativas: `max` falhas por janela de `windowMs`. */
class AttemptLimiter {
  private map = new Map<string, { count: number; first: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  private entry(key: string) {
    const e = this.map.get(key);
    if (e && Date.now() - e.first > this.windowMs) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  /** Segundos restantes de bloqueio (0 = liberado). */
  blockedFor(key: string): number {
    const e = this.entry(key);
    if (!e || e.count < this.max) return 0;
    return Math.ceil((e.first + this.windowMs - Date.now()) / 1000);
  }

  hit(key: string) {
    const e = this.entry(key);
    if (e) e.count++;
    else this.map.set(key, { count: 1, first: Date.now() });
  }

  clear(key: string) {
    this.map.delete(key);
  }

  sweep() {
    for (const k of [...this.map.keys()]) this.entry(k);
  }
}

export class Auth {
  private loginLimiter = new AttemptLimiter(5, 5 * 60_000);
  private registerLimiter = new AttemptLimiter(10, 10 * 60_000);
  private dummySalt = randomBytes(16).toString('hex');

  constructor(private wallet: Wallet) {
    this.wallet.db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  }

  private get db() {
    return this.wallet.db;
  }

  private createSession(userId: string): string {
    const token = randomBytes(32).toString('hex');
    this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_MS);
    return token;
  }

  async register(username: string, password: string, ip = ''): Promise<{ token: string; user: UserRow }> {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      fail('Usuário deve ter de 3 a 20 caracteres (letras, números e _).');
    }
    if (typeof password !== 'string' || password.length < 6) fail('A senha deve ter pelo menos 6 caracteres.');
    if (password.length > 200) fail('Senha muito longa.');
    const rk = `r:${ip}`;
    const wait = ip ? this.registerLimiter.blockedFor(rk) : 0;
    if (wait > 0) fail(`Muitos cadastros. Tente novamente em ${wait} s.`);
    if (this.wallet.getUserByName(username)) fail('Esse nome de usuário já está em uso.');

    const salt = randomBytes(16).toString('hex');
    const hash = (await hashPassword(password, salt)).toString('hex');
    const id = randomUUID();
    const cfg = this.wallet.cfg;
    try {
      this.db.tx(() => {
        const count = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users')!.c;
        const role: Role = count === 0 || cfg.adminUsernames.includes(username.toLowerCase()) ? 'admin' : 'user';
        this.db.run(
          `INSERT INTO users (id, username, pass_hash, salt, role, balance, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id, username, hash, salt, role, cfg.startBalance, Date.now(), Date.now(),
        );
        if (cfg.startBalance > 0) {
          this.db.run('INSERT INTO ledger (user_id, delta, reason, at) VALUES (?, ?, ?, ?)', id, cfg.startBalance, 'signup', Date.now());
        }
      });
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) fail('Esse nome de usuário já está em uso.');
      throw e;
    }
    if (ip) this.registerLimiter.hit(rk);
    const token = this.createSession(id);
    return { token, user: this.wallet.requireUser(id) };
  }

  async login(username: string, password: string, ip = ''): Promise<{ token: string; user: UserRow }> {
    const uk = `u:${String(username).toLowerCase()}`;
    const ik = `i:${ip}`;
    const wait = Math.max(this.loginLimiter.blockedFor(uk), ip ? this.loginLimiter.blockedFor(ik) : 0);
    if (wait > 0) fail(`Muitas tentativas de login. Tente novamente em ${wait} s.`);

    const user = typeof username === 'string' ? this.wallet.getUserByName(username) : undefined;
    // Calcula o hash mesmo para usuário inexistente (tempo constante)
    const computed = await hashPassword(String(password ?? ''), user?.salt ?? this.dummySalt);
    const ok = !!user && computed.length === Buffer.from(user.pass_hash, 'hex').length && timingSafeEqual(computed, Buffer.from(user.pass_hash, 'hex'));
    if (!ok) {
      this.loginLimiter.hit(uk);
      if (ip) this.loginLimiter.hit(ik);
      fail('Usuário ou senha incorretos.');
    }
    if (user!.banned) fail('Esta conta está banida.');
    this.loginLimiter.clear(uk);

    let u = user!;
    if (u.role !== 'admin' && this.wallet.cfg.adminUsernames.includes(u.username.toLowerCase())) {
      this.db.run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
      u = this.wallet.requireUser(u.id);
    }
    const token = this.createSession(u.id);
    this.wallet.touch(u.id);
    return { token, user: u };
  }

  /** Valida um token de sessão. null se inválido/expirado/banido. */
  verifyToken(token: unknown): UserRow | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
    const row = this.db.get<{ user_id: string; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token));
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
      return null;
    }
    const u = this.wallet.getUser(row.user_id);
    if (!u || u.banned) return null;
    return u;
  }

  logout(token: string) {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  }

  revokeSessions(userId: string) {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  async resetPassword(userId: string, password: string) {
    if (typeof password !== 'string' || password.length < 6) fail('A senha deve ter pelo menos 6 caracteres.');
    if (password.length > 200) fail('Senha muito longa.');
    this.wallet.requireUser(userId);
    const salt = randomBytes(16).toString('hex');
    const hash = (await hashPassword(password, salt)).toString('hex');
    this.db.tx(() => {
      this.db.run('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?', hash, salt, userId);
      this.revokeSessions(userId);
    });
  }

  sweep() {
    this.loginLimiter.sweep();
    this.registerLimiter.sweep();
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  }
}
