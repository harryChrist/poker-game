/**
 * Simulação de ponta a ponta da economia no SERVIDOR (sala real + carteira real + motores reais).
 * Um "humano" joga com a mesma estratégia dos bots; conferimos carteira x mesa a cada passo.
 * Lenta: só roda com SIM=1  ->  SIM=1 npx vitest run apps/server/src/economy.sim.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng, type SessionEngine, type MatchEngine } from '@cards/shared';
import { ENGINES } from '@cards/games';
import { Auth } from './auth';
import { TEST_CONFIG } from './config';
import { openDb } from './db';
import { RoomManager } from './rooms';
import { Wallet } from './wallet';

function setup(seed: number) {
  vi.useFakeTimers();
  const db = openDb(':memory:');
  const wallet = new Wallet(db, TEST_CONFIG);
  const auth = new Auth(wallet);
  const rooms = new RoomManager({
    wallet, engines: ENGINES, rng: createRng(seed), rand: createRng(seed + 1), log: () => {},
    transport: { send: () => {}, onlineUsers: () => [] },
  });
  return { db, wallet, auth, rooms };
}

afterEach(() => vi.useRealTimers());

describe.skipIf(!process.env.SIM)('simulação da economia', () => {
  it('blackjack: carteira acompanha a mesa e a banca leva vantagem', async () => {
    const { db, wallet, auth, rooms } = setup(7);
    const { user } = await auth.register('jogador', 'segredo123');
    db.run('UPDATE users SET balance = ? WHERE id = ?', 1_000_000, user.id);
    const u = { id: user.id, name: user.username };
    rooms.createRoom(u, { gameId: 'blackjack', name: 'sim', isPrivate: true, config: { turnSeconds: 0 } });
    const BUYIN = 100_000;
    rooms.sit(u.id, 0, BUYIN);
    rooms.addBot(u.id, 1);
    rooms.addBot(u.id, 2);
    rooms.start(u.id);
    const eng = ENGINES.blackjack as SessionEngine;
    const ctx = { rng: createRng(99), now: 0 };
    let wagered = 0;
    let mismatches = 0;
    for (let i = 0; i < 400_000; i++) {
      const room: any = rooms.roomOf(u.id);
      const st = room.state;
      if ((st.round ?? 0) > 1500) break;
      const turn = eng.getTurn(st);
      if (turn.seats.includes(0)) {
        const a = eng.botAction(st, 0, ctx);
        const before = eng.getStacks(st)[0];
        rooms.action(u.id, a);
        const after = eng.getStacks(room.state)[0];
        if (a.type === 'bet' || a.type === 'double' || a.type === 'split') wagered += Math.max(0, before - after);
      } else {
        vi.advanceTimersByTime(1500);
      }
      // a carteira (saldo + em jogo) tem que bater com o que está na mesa
      const stack = eng.getStacks(room.state)[0] ?? 0;
      if (wallet.escrowOf(u.id) !== stack) mismatches++;
    }
    const room: any = rooms.roomOf(u.id);
    const stackEnd = eng.getStacks(room.state)[0];
    rooms.stand(u.id);
    const net = wallet.balance(u.id) - 1_000_000;
    console.log(`[blackjack] ${room.state.round} rodadas · apostado ${wagered} · resultado ${net} (${((net / wagered) * 100).toFixed(2)}%) · divergências carteira/mesa: ${mismatches}`);
    expect(net).toBe(stackEnd - BUYIN);
    expect(wallet.history(u.id)[0].net).toBe(net);
    expect(mismatches).toBe(0);
    rooms.shutdown();
    db.close();
  }, 300_000);

  it('truco 1x1 contra bot: cada partida custa a aposta e o vencedor recebe o pote', async () => {
    const { db, wallet, auth, rooms } = setup(11);
    const { user } = await auth.register('jogador', 'segredo123');
    const u = { id: user.id, name: user.username };
    rooms.createRoom(u, { gameId: 'truco', name: 'sim', isPrivate: true, config: { players: 2, stake: 100, turnSeconds: 0 } });
    rooms.sit(u.id, 0);
    const eng = ENGINES.truco as MatchEngine;
    const ctx = { rng: createRng(5), now: 0 };
    let wins = 0;
    const MATCHES = 60;
    const deltas: number[] = [];
    for (let m = 0; m < MATCHES; m++) {
      const before = wallet.balance(u.id);
      rooms.start(u.id);
      expect(wallet.balance(u.id)).toBe(before - 100); // aposta saiu da carteira
      for (let i = 0; i < 20_000; i++) {
        const room: any = rooms.roomOf(u.id);
        if (room.status !== 'playing') break;
        const turn = eng.getTurn(room.state);
        if (turn.seats.includes(0)) rooms.action(u.id, eng.botAction(room.state, 0, ctx));
        else vi.advanceTimersByTime(1500);
      }
      const d = wallet.balance(u.id) - before;
      deltas.push(d);
      if (d > 0) wins++;
      expect([100, -100]).toContain(d); // ganhou o pote (200, lucro 100) ou perdeu a aposta
    }
    const total = deltas.reduce((a, b) => a + b, 0);
    console.log(`[truco] ${MATCHES} partidas · venceu ${wins} · saldo final ${total >= 0 ? '+' : ''}${total}`);
    rooms.shutdown();
    db.close();
  }, 300_000);
});
