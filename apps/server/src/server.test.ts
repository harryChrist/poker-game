import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAMES, type AnyEngine, type GameId, type MatchEngine, type SessionEngine } from '@cards/shared';
import { Auth } from './auth';
import { TEST_CONFIG } from './config';
import { openDb, type Db } from './db';
import { RoomManager } from './rooms';
import { Wallet } from './wallet';

// ---------- motores falsos ----------
const fakeSession: SessionEngine<any, any> = {
  id: 'poker',
  economy: 'session',
  create: () => ({ stacks: {} as Record<number, number> }),
  sitDown: (s, seat, _p, stack) => ({ state: { stacks: { ...s.stacks, [seat]: stack } } }),
  standUp: (s, seat) => {
    const { [seat]: cash = 0, ...rest } = s.stacks;
    return { state: { stacks: rest }, cashOut: cash };
  },
  addChips: (s, seat, n) => ({ state: { stacks: { ...s.stacks, [seat]: s.stacks[seat] + n } } }),
  getStacks: (s) => s.stacks,
  // ação 'win': o jogador ganha 500 fichas
  applyAction: (s, seat, a: any) =>
    a?.type === 'win' ? { state: { stacks: { ...s.stacks, [seat]: s.stacks[seat] + 500 } } } : { error: 'Ação inválida.' },
  advance: (s) => ({ state: s }),
  getView: (s) => s,
  getTurn: () => ({ seats: [], timeoutMs: 1000 }),
  timeoutAction: () => ({ type: 'noop' }),
  botAction: () => ({ type: 'noop' }),
};

const fakeMatch: MatchEngine<any, any> = {
  id: 'truco',
  economy: 'match',
  create: (_c, players) => ({ state: { players: players.length, winner: null as number | null } }),
  getResult: (s) => (s.winner === null ? null : { winners: [s.winner], summary: `Assento ${s.winner} venceu` }),
  replaceWithBot: (s) => s,
  applyAction: (s, seat, a: any) => (a?.type === 'win' ? { state: { ...s, winner: seat } } : { error: 'Ação inválida.' }),
  advance: (s) => ({ state: s }),
  getView: (s) => s,
  getTurn: () => ({ seats: [0], timeoutMs: 30_000 }),
  timeoutAction: () => ({ type: 'noop' }),
  botAction: () => ({ type: 'noop' }),
};

const engines = Object.fromEntries(
  (Object.keys(GAMES) as GameId[]).map((id) => [id, GAMES[id].economy === 'session' ? fakeSession : fakeMatch]),
) as Record<GameId, AnyEngine>;

// ---------- infraestrutura ----------
let db: Db;
let wallet: Wallet;
let auth: Auth;
let rooms: RoomManager;
let sent: { userId: string; event: string; payload: any }[];

async function mkUser(name: string) {
  const { user } = await auth.register(name, 'segredo123');
  return { id: user.id, name: user.username };
}

beforeEach(() => {
  db = openDb(':memory:');
  wallet = new Wallet(db, TEST_CONFIG);
  auth = new Auth(wallet);
  sent = [];
  rooms = new RoomManager({
    wallet,
    engines,
    rng: () => 0.5,
    rand: () => 0,
    log: () => {},
    transport: {
      send: (userId, event, payload) => void sent.push({ userId, event, payload }),
      onlineUsers: () => [],
    },
  });
});

afterEach(() => {
  rooms.shutdown();
  db.close();
  vi.useRealTimers();
});

// ---------- carteira ----------
describe('auth e carteira', () => {
  it('registra, valida login e primeiro usuário vira admin', async () => {
    const a = await auth.register('Alice', 'segredo123');
    const b = await auth.register('bob_1', 'segredo123');
    expect(a.user.role).toBe('admin');
    expect(b.user.role).toBe('user');
    expect(b.user.balance).toBe(10_000);
    await expect(auth.register('alice', 'segredo123')).rejects.toThrow(/em uso/);
    await expect(auth.register('x', 'segredo123')).rejects.toThrow();
    await expect(auth.register('carlos', '123')).rejects.toThrow();
    await expect(auth.login('bob_1', 'errada')).rejects.toThrow(/incorretos/);
    const l = await auth.login('BOB_1', 'segredo123');
    expect(auth.verifyToken(l.token)?.id).toBe(b.user.id);
    auth.logout(l.token);
    expect(auth.verifyToken(l.token)).toBeNull();
  });

  it('escrow mantém saldo + escrow e recarga/bônus respeitam regras', async () => {
    const u = await mkUser('carla');
    wallet.lockEscrow(u.id, 'r1', 4000, 'buyin');
    expect(wallet.balance(u.id)).toBe(6000);
    expect(wallet.escrowOf(u.id)).toBe(4000);
    expect(wallet.total(u.id)).toBe(10_000);
    expect(wallet.buildMe(u.id, null).inPlay).toBe(4000);
    expect(() => wallet.lockEscrow(u.id, 'r1', 999_999, 'buyin')).toThrow();
    expect(wallet.total(u.id)).toBe(10_000);

    // recarga só abaixo do limite
    expect(() => wallet.refill(u.id)).toThrow(/menos de/);
    wallet.releaseEscrow(u.id, 'r1', 0, 'cashout'); // perdeu tudo na mesa
    wallet.adjust(u.id, -(wallet.balance(u.id) - 500), 'teste');
    wallet.refill(u.id);
    expect(wallet.total(u.id)).toBe(10_000);
    expect(() => wallet.refill(u.id)).toThrow();

    // bônus diário 1x a cada 24h
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    const before = wallet.balance(u.id);
    wallet.daily(u.id);
    expect(wallet.balance(u.id)).toBe(before + 1000);
    expect(() => wallet.daily(u.id)).toThrow();
    vi.setSystemTime(Date.now() + 24 * 3600_000 + 1000);
    wallet.daily(u.id);
    expect(wallet.balance(u.id)).toBe(before + 2000);
  });

  it('no boot devolve todo escrow remanescente às carteiras', async () => {
    const u = await mkUser('dani');
    wallet.lockEscrow(u.id, 'sala-que-caiu', 3000, 'buyin');
    expect(wallet.balance(u.id)).toBe(7000);
    expect(wallet.returnAllEscrow()).toBe(1);
    expect(wallet.balance(u.id)).toBe(10_000);
    expect(wallet.escrowOf(u.id)).toBe(0);
    expect(db.get('SELECT COUNT(*) AS c FROM escrow')!.c).toBe(0);
  });
});

// ---------- session ----------
describe('sala session (poker)', () => {
  it('sentar debita, ação muda a pilha, levantar devolve cashOut e grava histórico', async () => {
    const u = await mkUser('erica');
    const st = rooms.createRoom(u, { gameId: 'poker', name: 'Mesa 1', isPrivate: false, config: {} });
    expect(st.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(() => rooms.sit(u.id, 0, 5)).toThrow(/entre/i); // fora do mín/máx
    rooms.sit(u.id, 0, 1000);
    expect(wallet.balance(u.id)).toBe(9000);
    expect(wallet.escrowOf(u.id)).toBe(1000);

    // a mesa só começa quando o líder manda (e com o mínimo de jogadores)
    expect(() => rooms.action(u.id, { type: 'win' })).toThrow(/líder/);
    expect(() => rooms.start(u.id)).toThrow(/pelo menos 2/);
    rooms.addBot(u.id, 1);
    rooms.start(u.id);
    expect(() => rooms.start(u.id)).toThrow(/já começou/);

    rooms.action(u.id, { type: 'win' });
    expect(wallet.escrowOf(u.id)).toBe(1500); // escrow acompanha getStacks
    expect(() => rooms.action(u.id, { type: 'x' })).toThrow(/inválida/);

    rooms.stand(u.id);
    expect(wallet.escrowOf(u.id)).toBe(0);
    expect(wallet.balance(u.id)).toBe(10_500);
    const h = wallet.history(u.id);
    expect(h).toHaveLength(1);
    expect(h[0].net).toBe(500);
    expect(sent.some((e) => e.userId === u.id && e.event === 'game:view')).toBe(true);
  });

  it('desconectado por 60s levanta e devolve as fichas', async () => {
    vi.useFakeTimers();
    const u = await mkUser('fabio');
    const v = await mkUser('gabi');
    rooms.createRoom(u, { gameId: 'poker', name: 'Mesa 2', isPrivate: false, config: {} });
    rooms.join(v, { code: [...(rooms as any).rooms.values()][0].code });
    rooms.sit(v.id, 1, 1000);
    rooms.onDisconnect(v.id);
    vi.advanceTimersByTime(61_000);
    expect(wallet.escrowOf(v.id)).toBe(0);
    expect(wallet.balance(v.id)).toBe(10_000);
    expect(rooms.roomIdOf(v.id)).toBeNull();
  });
});

// ---------- match ----------
describe('sala match (truco)', () => {
  it('start debita a aposta, completa com bots e paga o pote ao vencedor', async () => {
    const a = await mkUser('henrique');
    const b = await mkUser('iris');
    const st = rooms.createRoom(a, { gameId: 'truco', name: 'Truco', isPrivate: true, config: { players: 4, stake: 100 } });
    rooms.join(b, { code: st.code.toLowerCase() });
    rooms.sit(a.id, 0);
    rooms.sit(b.id, 1);
    expect(() => rooms.start(b.id)).toThrow(/anfitrião/);
    // todos os sentados (fora o líder) precisam estar prontos
    expect(() => rooms.start(a.id)).toThrow(/pronto: iris/);
    rooms.setReady(b.id, true);
    expect(rooms.roomOf(a.id)!.toState().seats[1]!.ready).toBe(true);
    // líder remove alguém: sai da sala e não pode voltar
    const c = await mkUser('joana');
    rooms.join(c, { code: st.code });
    expect(() => rooms.kick(b.id, c.id)).toThrow(/anfitrião/);
    rooms.kick(a.id, c.id);
    expect(rooms.roomOf(c.id)).toBeNull();
    expect(() => rooms.join(c, { code: st.code })).toThrow(/removido/);
    rooms.start(a.id);
    expect(rooms.roomOf(a.id)!.toState().seats[1]!.ready).toBe(false); // pronto zera ao começar

    expect(wallet.balance(a.id)).toBe(9900);
    expect(wallet.balance(b.id)).toBe(9900);
    expect(wallet.escrowOf(a.id)).toBe(100);
    expect(rooms.roomOf(a.id)!.toState().status).toBe('playing');
    expect(rooms.roomOf(a.id)!.toState().seats.filter((s) => s?.isBot)).toHaveLength(2);

    rooms.action(a.id, { type: 'win' }); // assento 0 vence
    // pote = 100 x 4 assentos = 400
    expect(wallet.balance(a.id)).toBe(9900 + 400);
    expect(wallet.balance(b.id)).toBe(9900);
    expect(wallet.escrowOf(a.id) + wallet.escrowOf(b.id)).toBe(0);
    const state = rooms.roomOf(a.id)!.toState();
    expect(state.status).toBe('waiting');
    expect(state.lastResult).toMatchObject({ winners: [0], payoutEach: 400 });
    expect(state.seats.filter(Boolean)).toHaveLength(4); // assentos mantidos
    expect(wallet.history(a.id)[0].net).toBe(300);
    expect(wallet.history(b.id)[0].net).toBe(-100);
    expect(wallet.getUser(a.id)!.wins).toBe(1);
    expect(wallet.getUser(b.id)!.played).toBe(1);
  });

  it('sala fechada no meio da partida devolve as apostas', async () => {
    const a = await mkUser('juca');
    const st = rooms.createRoom(a, { gameId: 'truco', name: 'T', isPrivate: false, config: { players: 2, stake: 200 } });
    rooms.sit(a.id, 0);
    rooms.start(a.id);
    expect(wallet.balance(a.id)).toBe(9800);
    rooms.closeRoom(st.id, 'fechada');
    expect(wallet.balance(a.id)).toBe(10_000);
    expect(rooms.count).toBe(0);
  });
});
