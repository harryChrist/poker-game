import { randomUUID } from 'node:crypto';
import type { GameId, HistoryEntry, Me, RankingEntry, Role } from '@cards/shared';
import type { Config } from './config';
import { fail } from './config';
import type { Db } from './db';

export interface UserRow {
  id: string;
  username: string;
  pass_hash: string;
  salt: string;
  role: Role;
  balance: number;
  banned: number;
  wins: number;
  played: number;
  created_at: number;
  last_seen_at: number | null;
  last_refill_at: number | null;
  last_daily_at: number | null;
}


export class Wallet {
  constructor(
    readonly db: Db,
    readonly cfg: Config,
  ) {}

  // ---------- usuários ----------
  getUser(id: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  getUserByName(username: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
  }

  requireUser(id: string): UserRow {
    const u = this.getUser(id);
    if (!u) fail('Usuário não encontrado.');
    return u;
  }

  // ---------- saldo ----------
  balance(userId: string): number {
    return this.requireUser(userId).balance;
  }

  escrowOf(userId: string): number {
    const r = this.db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM escrow WHERE user_id = ?', userId);
    return Number(r?.s ?? 0);
  }

  total(userId: string): number {
    return this.balance(userId) + this.escrowOf(userId);
  }

  private ledger(userId: string, delta: number, reason: string) {
    this.db.run('INSERT INTO ledger (user_id, delta, reason, at) VALUES (?, ?, ?, ?)', userId, delta, reason, Date.now());
  }

  /** Altera o saldo (delta pode ser negativo). Nunca deixa ficar negativo. */
  adjust(userId: string, delta: number, reason: string): number {
    if (!Number.isSafeInteger(delta)) fail('Valor inválido.');
    return this.db.tx(() => {
      const u = this.requireUser(userId);
      const next = u.balance + delta;
      if (next < 0) fail('Saldo insuficiente.');
      this.db.run('UPDATE users SET balance = ? WHERE id = ?', next, userId);
      if (delta !== 0) this.ledger(userId, delta, reason);
      return next;
    });
  }

  // ---------- escrow ----------
  /** Debita do saldo e soma ao escrow (buy-in, rebuy, aposta de partida). */
  lockEscrow(userId: string, roomId: string, amount: number, reason: string) {
    this.lockEscrowMany(roomId, [{ userId, amount }], reason);
  }

  lockEscrowMany(roomId: string, items: { userId: string; amount: number }[], reason: string) {
    this.db.tx(() => {
      for (const { userId, amount } of items) {
        if (!Number.isSafeInteger(amount) || amount <= 0) fail('Valor inválido.');
        const u = this.requireUser(userId);
        if (u.balance < amount) fail(`${u.username} não tem fichas suficientes.`);
        this.db.run('UPDATE users SET balance = balance - ? WHERE id = ?', amount, userId);
        this.db.run(
          `INSERT INTO escrow (user_id, room_id, amount) VALUES (?, ?, ?)
           ON CONFLICT(user_id, room_id) DO UPDATE SET amount = amount + excluded.amount`,
          userId, roomId, amount,
        );
        this.ledger(userId, -amount, reason);
      }
    });
  }

  /** Remove o escrow da sala e credita `payout` (cashOut, prêmio, devolução) no saldo. */
  releaseEscrow(userId: string, roomId: string, payout: number, reason: string) {
    this.db.tx(() => {
      const p = Math.max(0, Math.floor(payout));
      this.db.run('DELETE FROM escrow WHERE user_id = ? AND room_id = ?', userId, roomId);
      if (p > 0) {
        this.db.run('UPDATE users SET balance = balance + ? WHERE id = ?', p, userId);
        this.ledger(userId, p, reason);
      }
    });
  }

  /** Perde o escrow (abandono de partida). */
  forfeitEscrow(userId: string, roomId: string) {
    this.db.run('DELETE FROM escrow WHERE user_id = ? AND room_id = ?', userId, roomId);
  }

  /** Alinha o escrow com as fichas atuais da mesa (não mexe no saldo). Devolve os usuários cujo valor mudou. */
  syncEscrow(roomId: string, items: { userId: string; amount: number }[]): string[] {
    const changed: string[] = [];
    this.db.tx(() => {
      for (const { userId, amount } of items) {
        const r = this.db.run(
          'UPDATE escrow SET amount = ? WHERE user_id = ? AND room_id = ? AND amount != ?',
          amount, userId, roomId, amount,
        );
        if (r.changes > 0) changed.push(userId);
      }
    });
    return changed;
  }

  escrowAmount(userId: string, roomId: string): number {
    const r = this.db.get<{ amount: number }>('SELECT amount FROM escrow WHERE user_id = ? AND room_id = ?', userId, roomId);
    return r?.amount ?? 0;
  }

  /** No boot: o servidor caiu, devolve tudo que estava preso. Retorna quantos usuários foram reembolsados. */
  returnAllEscrow(): number {
    return this.db.tx(() => {
      const rows = this.db.all<{ user_id: string; amount: number }>('SELECT user_id, amount FROM escrow');
      const users = new Set<string>();
      for (const r of rows) {
        if (r.amount > 0) {
          this.db.run('UPDATE users SET balance = balance + ? WHERE id = ?', r.amount, r.user_id);
          this.ledger(r.user_id, r.amount, 'escrow-return');
        }
        users.add(r.user_id);
      }
      this.db.run('DELETE FROM escrow');
      return users.size;
    });
  }

  // ---------- recarga / bônus ----------
  refillAvailableAt(u: UserRow): number | null {
    if (!u.last_refill_at) return null;
    const at = u.last_refill_at + this.cfg.refillCooldownMin * 60_000;
    return at > Date.now() ? at : null;
  }

  dailyAvailableAt(u: UserRow): number | null {
    if (!u.last_daily_at) return null;
    const at = u.last_daily_at + this.cfg.bonusIntervalMin * 60_000;
    return at > Date.now() ? at : null;
  }

  /** `blocked`: o usuário está sentado numa mesa com fichas em jogo (impede abusar da recarga). */
  refill(userId: string, blocked = false) {
    this.db.tx(() => {
      const u = this.requireUser(userId);
      if (blocked) fail('Saia da mesa antes de pedir recarga.');
      const total = u.balance + this.escrowOf(userId);
      if (total >= this.cfg.refillThreshold) {
        fail(`A recarga só está disponível quando você tem menos de ${this.cfg.refillThreshold} fichas.`);
      }
      const at = this.refillAvailableAt(u);
      if (at) {
        const min = Math.ceil((at - Date.now()) / 60_000);
        fail(`Recarga disponível novamente em ${min} min.`);
      }
      const delta = Math.max(0, this.cfg.refillTo - total);
      this.db.run('UPDATE users SET balance = balance + ?, last_refill_at = ? WHERE id = ?', delta, Date.now(), userId);
      if (delta > 0) this.ledger(userId, delta, 'refill');
    });
  }

  daily(userId: string) {
    this.db.tx(() => {
      const u = this.requireUser(userId);
      const at = this.dailyAvailableAt(u);
      if (at) {
        const min = Math.ceil((at - Date.now()) / 60_000);
        fail(`Bônus disponível de novo em ${min} min.`);
      }
      this.db.run('UPDATE users SET balance = balance + ?, last_daily_at = ? WHERE id = ?', this.cfg.dailyBonus, Date.now(), userId);
      this.ledger(userId, this.cfg.dailyBonus, 'daily');
    });
  }

  buildMe(userId: string, roomId: string | null): Me {
    const u = this.requireUser(userId);
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      balance: u.balance,
      inPlay: this.escrowOf(userId),
      refillAvailableAt: this.refillAvailableAt(u),
      dailyAvailableAt: this.dailyAvailableAt(u),
      roomId,
    };
  }

  // ---------- estatísticas / histórico ----------
  addHistory(userId: string, e: { gameId: GameId; roomName: string; net: number; summary: string }) {
    this.db.run(
      'INSERT INTO history (id, user_id, game_id, room_name, net, summary, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      randomUUID(), userId, e.gameId, e.roomName, Math.trunc(e.net), e.summary, Date.now(),
    );
  }

  addStats(userId: string, s: { played?: number; wins?: number }) {
    this.db.run('UPDATE users SET played = played + ?, wins = wins + ? WHERE id = ?', s.played ?? 0, s.wins ?? 0, userId);
  }

  history(userId: string, limit = 50): HistoryEntry[] {
    return this.db
      .all<{ id: string; game_id: GameId; room_name: string; net: number; summary: string; ended_at: number }>(
        'SELECT * FROM history WHERE user_id = ? ORDER BY ended_at DESC, rowid DESC LIMIT ?',
        userId, limit,
      )
      .map((r) => ({ id: r.id, gameId: r.game_id, roomName: r.room_name, net: r.net, summary: r.summary, endedAt: r.ended_at }));
  }

  ranking(limit = 50): RankingEntry[] {
    return this.db
      .all<{ id: string; username: string; total: number; wins: number; played: number }>(
        `SELECT u.id, u.username, u.wins, u.played,
                u.balance + COALESCE((SELECT SUM(amount) FROM escrow e WHERE e.user_id = u.id), 0) AS total
           FROM users u WHERE u.banned = 0
          ORDER BY total DESC, u.wins DESC, u.username ASC LIMIT ?`,
        limit,
      )
      .map((r) => ({ userId: r.id, username: r.username, total: Number(r.total), wins: r.wins, played: r.played }));
  }

  touch(userId: string) {
    this.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', Date.now(), userId);
  }
}
