import { randomUUID } from 'node:crypto';
import {
  GAMES, isEngineError, seatCount,
  type AnyEngine, type ChatMsg, type EngineCtx, type GameEvent, type GameId, type MatchEngine, type MatchResult,
  type RoomState, type RoomStatus, type RoomSummary, type SeatPlayer, type ServerEventName, type ServerEvents,
  type SessionEngine, type StepResult, type TurnInfo,
} from '@cards/shared';
import { fail } from './config';
import type { Wallet } from './wallet';

export interface Transport {
  send<E extends ServerEventName>(userId: string, event: E, payload: ServerEvents[E]): void;
}

export interface RoomDeps {
  wallet: Wallet;
  transport: Transport;
  /** RNG dos motores (cryptoRng em produção) */
  rng: () => number;
  /** Aleatoriedade "de interface" (atraso dos bots). Math.random em produção. */
  rand: () => number;
  log: (msg: string, err?: unknown) => void;
  /** Registra/remove a associação usuário -> sala */
  bind: (userId: string, room: Room | null) => void;
  /** Algo visível no lobby mudou */
  changed: () => void;
  /** A sala foi fechada */
  closed: (room: Room) => void;
  /** Reenvia `me` ao usuário (saldo mudou) */
  pushMe: (userId: string) => void;
}

export const DISCONNECT_STAND_MS = 60_000;
export const DISCONNECTED_TURN_MS = 4_000;
/** Em sala sem limite de tempo, quanto esperar um desconectado antes de jogar automaticamente por ele */
export const NO_LIMIT_DISCONNECTED_MS = 30_000;
export const IDLE_CLOSE_MS = 2 * 60_000;
export const MAX_CONSECUTIVE_TIMEOUTS = 3;
const BOT_DELAY_MIN = 600;
const BOT_DELAY_SPAN = 800;
const CHAT_LIMIT = 5;
const CHAT_WINDOW_MS = 5_000;
const CHAT_KEEP = 50;
const MAX_MEMBERS = 60;
const BOT_NAMES = ['Ana', 'Beto', 'Carla', 'Duda', 'Edu', 'Fabi', 'Gabi', 'Hugo', 'Iara', 'João', 'Lia', 'Marcos'];

interface Slot {
  userId: string;
  name: string;
  isBot: boolean;
}

interface Member {
  userId: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  discTimer: ReturnType<typeof setTimeout> | null;
  /** o timer de desconexão já estourou durante uma partida: sai quando a partida acabar */
  dropPending: boolean;
  timeouts: number;
  chatTimes: number[];
}

interface TurnTimer {
  kind: 'bot' | 'human' | 'disc' | 'retry';
  handle: ReturnType<typeof setTimeout>;
  deadline: number | null;
  /** prazo "cheio" do humano (usado ao reconectar) */
  base: number;
}

export interface RoomInit {
  id: string;
  code: string;
  name: string;
  gameId: GameId;
  isPrivate: boolean;
  config: Record<string, number>;
  host: { userId: string; name: string };
  engine: AnyEngine;
}

export class Room {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly gameId: GameId;
  readonly isPrivate: boolean;
  readonly config: Record<string, number>;
  readonly createdAt = Date.now();
  readonly engine: AnyEngine;
  readonly economy: 'session' | 'match';

  hostUserId: string;
  hostName: string;
  status: RoomStatus = 'waiting';
  closed = false;

  private closing = false;
  private members = new Map<string, Member>();
  private seats: (Slot | null)[];
  private state: any = null;
  private seq = 0;
  private lastResult: RoomState['lastResult'] = null;
  private chatLog: ChatMsg[] = [];
  private botCounter = 0;
  /** total investido por usuário na sessão (buy-ins + rebuys) */
  private invested = new Map<string, number>();
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimers = new Map<number, TurnTimer>();
  private failCount = new Map<number, number>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private deps: RoomDeps,
    init: RoomInit,
  ) {
    this.id = init.id;
    this.code = init.code;
    this.name = init.name;
    this.gameId = init.gameId;
    this.isPrivate = init.isPrivate;
    this.config = init.config;
    this.engine = init.engine;
    this.economy = GAMES[init.gameId].economy;
    this.hostUserId = init.host.userId;
    this.hostName = init.host.name;
    this.seats = Array.from({ length: seatCount(this.gameId, this.config) }, () => null);
    if (this.economy === 'session') {
      this.state = this.session.create(this.config, this.ctx());
    }
  }

  // ---------- helpers ----------
  private get session(): SessionEngine {
    return this.engine as SessionEngine;
  }
  private get match(): MatchEngine {
    return this.engine as MatchEngine;
  }
  private ctx(): EngineCtx {
    return { rng: this.deps.rng, now: Date.now() };
  }
  private send<E extends ServerEventName>(userId: string, event: E, payload: ServerEvents[E]) {
    try {
      this.deps.transport.send(userId, event, payload);
    } catch (e) {
      this.deps.log(`falha ao enviar ${event}`, e);
    }
  }
  private sendAll<E extends ServerEventName>(event: E, payload: ServerEvents[E]) {
    for (const m of this.members.values()) this.send(m.userId, event, payload);
  }
  private timer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        this.deps.log(`[${this.id}] erro em timer`, e);
      }
    }, Math.max(0, ms));
    (t as any).unref?.();
    return t;
  }

  get seatTotal() {
    return this.seats.length;
  }
  get humanCount() {
    return this.members.size;
  }
  hasMember(userId: string) {
    return this.members.has(userId);
  }
  memberIds(): string[] {
    return [...this.members.keys()];
  }
  seatOf(userId: string): number | null {
    const i = this.seats.findIndex((s) => s && !s.isBot && s.userId === userId);
    return i === -1 ? null : i;
  }
  /** O usuário tem fichas em risco nesta sala (impede recarga) */
  isInPlay(userId: string): boolean {
    if (this.seatOf(userId) === null) return false;
    return this.economy === 'session' || this.status === 'playing';
  }

  // ---------- estado público ----------
  toState(): RoomState {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      gameId: this.gameId,
      isPrivate: this.isPrivate,
      hostUserId: this.hostUserId,
      status: this.status,
      config: this.config,
      seats: this.seats.map((s, i) =>
        s ? { seat: i, userId: s.userId, name: s.name, isBot: s.isBot, connected: s.isBot ? true : !!this.members.get(s.userId)?.connected } : null,
      ),
      spectators: [...this.members.values()].filter((m) => this.seatOf(m.userId) === null).map((m) => ({ userId: m.userId, name: m.name })),
      lastResult: this.lastResult,
    };
  }

  stakesLabel(): string {
    const c = this.config;
    if (this.gameId === 'poker') return `Blinds ${c.smallBlind}/${c.bigBlind}`;
    if (this.gameId === 'blackjack') return `Aposta ${c.minBet}-${c.maxBet}`;
    return `Aposta ${c.stake}`;
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      gameId: this.gameId,
      isPrivate: this.isPrivate,
      hostName: this.hostName,
      status: this.status,
      seatsTotal: this.seats.length,
      seatsTaken: this.seats.filter(Boolean).length,
      humans: this.members.size,
      stakesLabel: this.stakesLabel(),
      createdAt: this.createdAt,
    };
  }

  private broadcastState() {
    if (this.closed) return;
    const st = this.toState();
    this.sendAll('room:state', st);
    this.deps.changed();
  }

  // ---------- chat ----------
  private pushChat(msg: ChatMsg) {
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.splice(0, this.chatLog.length - CHAT_KEEP);
    this.sendAll('chat:msg', msg);
  }

  private sysChat(text: string) {
    if (this.closed) return;
    this.pushChat({ id: randomUUID(), roomId: this.id, userId: '', name: 'Sistema', text, at: Date.now(), system: true });
  }

  chat(userId: string, text: string) {
    const m = this.members.get(userId);
    if (!m) fail('Você não está nesta sala.');
    const t = String(text ?? '').trim();
    if (t.length < 1) fail('Mensagem vazia.');
    if (t.length > 200) fail('Mensagem muito longa (máx. 200 caracteres).');
    const now = Date.now();
    m.chatTimes = m.chatTimes.filter((x) => now - x < CHAT_WINDOW_MS);
    if (m.chatTimes.length >= CHAT_LIMIT) fail('Você está enviando mensagens rápido demais.');
    m.chatTimes.push(now);
    this.pushChat({ id: randomUUID(), roomId: this.id, userId, name: m.name, text: t, at: now });
  }

  // ---------- membros ----------
  private sendInitial(userId: string) {
    this.send(userId, 'room:state', this.toState());
    this.send(userId, 'chat:history', [...this.chatLog]);
    if (this.state !== null) this.sendView(userId, this.seq, this.currentTurn());
  }

  addMember(userId: string, name: string) {
    if (this.members.has(userId)) return;
    if (this.members.size >= MAX_MEMBERS) fail('A sala está lotada.');
    this.members.set(userId, {
      userId, name, connected: true, joinedAt: Date.now(), discTimer: null, dropPending: false, timeouts: 0, chatTimes: [],
    });
    this.deps.bind(userId, this);
    this.checkIdle();
    this.sendInitial(userId);
    this.sysChat(`${name} entrou na sala.`);
    this.broadcastState();
  }

  /** Reconexão: reenvia tudo ao usuário */
  setConnected(userId: string, connected: boolean) {
    const m = this.members.get(userId);
    if (!m || this.closed) return;
    if (m.connected === connected) {
      if (connected) this.sendInitial(userId);
      return;
    }
    m.connected = connected;
    if (m.discTimer) {
      clearTimeout(m.discTimer);
      m.discTimer = null;
    }
    if (connected) {
      m.dropPending = false;
      this.sendInitial(userId);
    } else {
      m.discTimer = this.timer(DISCONNECT_STAND_MS, () => this.onDisconnectTimeout(userId));
    }
    this.checkIdle();
    this.broadcastState();
    const seat = this.seatOf(userId);
    if (seat !== null) {
      const turn = this.currentTurn();
      this.ensureTurnTimers();
      if (turn.seats.includes(seat)) this.broadcastView();
    }
  }

  private onDisconnectTimeout(userId: string) {
    const m = this.members.get(userId);
    if (!m || m.connected || this.closed) return;
    m.discTimer = null;
    if (this.economy === 'match' && this.status === 'playing' && this.seatOf(userId) !== null) {
      m.dropPending = true; // mantém o assento até a partida acabar
      return;
    }
    this.removeMember(userId, 'Você foi desconectado da sala.');
  }

  removeMember(userId: string, reason?: string) {
    const m = this.members.get(userId);
    if (!m) return;
    if (this.seatOf(userId) !== null) {
      try {
        this.standUser(userId);
      } catch (e) {
        this.deps.log(`[${this.id}] erro ao levantar ${m.name}`, e);
        this.emergencyRelease(userId);
      }
    }
    if (m.discTimer) clearTimeout(m.discTimer);
    this.members.delete(userId);
    this.deps.bind(userId, null);
    if (reason) this.send(userId, 'room:left', { roomId: this.id, reason });
    this.deps.pushMe(userId);
    if (this.closed || this.closing) return;
    this.sysChat(`${m.name} saiu da sala.`);
    if (this.members.size === 0) {
      this.close('A sala ficou vazia.');
      return;
    }
    if (this.hostUserId === userId) this.transferHost();
    if (this.closed) return;
    this.checkIdle();
    this.broadcastState();
  }

  /** Devolve o escrow à carteira quando o motor falhou ao levantar o jogador */
  private emergencyRelease(userId: string) {
    const seat = this.seatOf(userId);
    if (seat !== null) this.seats[seat] = null;
    try {
      const amount = this.deps.wallet.escrowAmount(userId, this.id);
      this.deps.wallet.releaseEscrow(userId, this.id, this.economy === 'session' ? amount : 0, 'emergency-return');
    } catch (e) {
      this.deps.log(`[${this.id}] emergencyRelease falhou`, e);
    }
  }

  private transferHost() {
    const next = [...this.members.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0];
    if (!next) return;
    this.hostUserId = next.userId;
    this.hostName = next.name;
    this.sysChat(`${next.name} agora é o anfitrião.`);
  }

  private hasConnectedHuman(): boolean {
    for (const m of this.members.values()) if (m.connected) return true;
    return false;
  }

  /** Sala sem humanos conectados por IDLE_CLOSE_MS é fechada */
  private checkIdle() {
    if (this.closed) return;
    if (this.hasConnectedHuman()) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
    } else if (!this.idleTimer) {
      this.idleTimer = this.timer(IDLE_CLOSE_MS, () => this.close('Sala encerrada por inatividade.'));
    }
  }

  // ---------- sentar / levantar ----------
  sit(userId: string, seat: number, buyIn?: number) {
    const m = this.members.get(userId);
    if (!m) fail('Você não está nesta sala.');
    if (this.seatOf(userId) !== null) fail('Você já está sentado.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) fail('Assento inválido.');
    if (this.seats[seat]) fail('Esse assento está ocupado.');
    const wallet = this.deps.wallet;
    const slot: Slot = { userId, name: m.name, isBot: false };

    if (this.economy === 'match') {
      if (this.status === 'playing') fail('A partida já começou.');
      this.seats[seat] = slot;
      this.sysChat(`${m.name} sentou.`);
      this.broadcastState();
      return;
    }

    if (typeof buyIn !== 'number' || !Number.isInteger(buyIn)) fail('Informe o valor da entrada.');
    const { minBuyIn, maxBuyIn } = this.config;
    if (buyIn < minBuyIn || buyIn > maxBuyIn) fail(`A entrada deve ficar entre ${minBuyIn} e ${maxBuyIn}.`);
    if (wallet.balance(userId) < buyIn) fail('Saldo insuficiente para essa entrada.');
    const r = this.engineCall(() => this.session.sitDown(this.state, seat, { userId, name: m.name, isBot: false }, buyIn, this.ctx()));
    if (isEngineError(r)) fail(r.error);
    wallet.lockEscrow(userId, this.id, buyIn, `buyin:${this.gameId}`);
    this.invested.set(userId, (this.invested.get(userId) ?? 0) + buyIn);
    this.seats[seat] = slot;
    m.timeouts = 0;
    this.applyStep(r);
    this.sysChat(`${m.name} sentou com ${buyIn} fichas.`);
    this.broadcastState();
    this.deps.pushMe(userId);
  }

  stand(userId: string) {
    if (!this.members.has(userId)) fail('Você não está nesta sala.');
    if (this.seatOf(userId) === null) fail('Você não está sentado.');
    this.standUser(userId);
  }

  private standUser(userId: string) {
    const seat = this.seatOf(userId);
    if (seat === null) return;
    const wallet = this.deps.wallet;
    const name = this.members.get(userId)?.name ?? '?';

    if (this.economy === 'session') {
      const r = this.engineCall(() => this.session.standUp(this.state, seat, this.ctx()));
      const cash = Math.max(0, Math.floor(r.cashOut));
      const invested = this.invested.get(userId) ?? 0;
      this.seats[seat] = null;
      this.invested.delete(userId);
      wallet.db.tx(() => {
        wallet.releaseEscrow(userId, this.id, cash, `cashout:${this.gameId}`);
        wallet.addHistory(userId, {
          gameId: this.gameId, roomName: this.name, net: cash - invested,
          summary: `Saiu da mesa com ${cash} fichas`,
        });
      });
      this.applyStep(r, seat);
      this.sysChat(`${name} saiu da mesa.`);
      this.broadcastState();
      this.deps.pushMe(userId);
      return;
    }

    // match
    if (this.status !== 'playing') {
      this.seats[seat] = null;
      this.sysChat(`${name} levantou.`);
      this.broadcastState();
      return;
    }
    const stake = this.config.stake;
    wallet.db.tx(() => {
      wallet.forfeitEscrow(userId, this.id);
      wallet.addHistory(userId, { gameId: this.gameId, roomName: this.name, net: -stake, summary: 'Abandonou a partida' });
      wallet.addStats(userId, { played: 1 });
    });
    const bot = this.newBot();
    this.seats[seat] = bot;
    try {
      this.state = this.match.replaceWithBot(this.state, seat, bot.name);
    } catch (e) {
      this.deps.log(`[${this.id}] replaceWithBot falhou`, e);
    }
    this.sysChat(`${name} abandonou a partida e foi substituído por ${bot.name}.`);
    this.applyStep({ state: this.state }, seat);
    this.broadcastState();
    this.deps.pushMe(userId);
  }

  addChips(userId: string, amount: number) {
    if (this.economy !== 'session') fail('Este jogo não permite adicionar fichas.');
    const m = this.members.get(userId);
    const seat = this.seatOf(userId);
    if (!m || seat === null) fail('Você não está sentado.');
    if (!Number.isInteger(amount) || amount <= 0) fail('Valor inválido.');
    const wallet = this.deps.wallet;
    const stack = this.engineCall(() => this.session.getStacks(this.state))[seat] ?? 0;
    if (stack + amount > this.config.maxBuyIn) fail(`Você pode ter no máximo ${this.config.maxBuyIn} fichas na mesa.`);
    if (wallet.balance(userId) < amount) fail('Saldo insuficiente.');
    const r = this.engineCall(() => this.session.addChips(this.state, seat, amount, this.ctx()));
    if (isEngineError(r)) fail(r.error);
    wallet.lockEscrow(userId, this.id, amount, `rebuy:${this.gameId}`);
    this.invested.set(userId, (this.invested.get(userId) ?? 0) + amount);
    this.applyStep(r);
    this.deps.pushMe(userId);
  }

  // ---------- bots ----------
  private newBot(): Slot {
    const used = new Set(this.seats.filter((s) => s?.isBot).map((s) => s!.name));
    const base = BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? `${++this.botCounter}`;
    return { userId: `bot:${this.id}:${++this.botCounter}`, name: `Bot ${base}`, isBot: true };
  }

  private requireHost(userId: string) {
    if (!this.members.has(userId)) fail('Você não está nesta sala.');
    if (this.hostUserId !== userId) fail('Só o anfitrião pode fazer isso.');
  }

  addBot(userId: string, seat: number) {
    this.requireHost(userId);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) fail('Assento inválido.');
    if (this.seats[seat]) fail('Esse assento está ocupado.');
    if (this.economy === 'match' && this.status === 'playing') fail('A partida já começou.');
    const bot = this.newBot();
    if (this.economy === 'session') {
      const r = this.engineCall(() => this.session.sitDown(this.state, seat, this.asPlayer(bot), this.config.maxBuyIn, this.ctx()));
      if (isEngineError(r)) fail(r.error);
      this.seats[seat] = bot;
      this.applyStep(r);
    } else {
      this.seats[seat] = bot;
    }
    this.broadcastState();
  }

  removeBot(userId: string, seat: number) {
    this.requireHost(userId);
    const slot = this.seats[seat];
    if (!slot || !slot.isBot) fail('Não há bot nesse assento.');
    if (this.economy === 'match' && this.status === 'playing') fail('A partida já começou.');
    if (this.economy === 'session') {
      const r = this.engineCall(() => this.session.standUp(this.state, seat, this.ctx()));
      this.seats[seat] = null;
      this.applyStep(r, seat);
    } else {
      this.seats[seat] = null;
    }
    this.broadcastState();
  }

  private asPlayer(s: Slot): SeatPlayer {
    return { userId: s.userId, name: s.name, isBot: s.isBot };
  }

  // ---------- partida (match) ----------
  start(userId: string) {
    this.requireHost(userId);
    if (this.economy !== 'match') fail('Este jogo não precisa ser iniciado.');
    if (this.status === 'playing') fail('A partida já está em andamento.');
    const humans = this.seats.filter((s): s is Slot => !!s && !s.isBot);
    if (humans.length === 0) fail('Sente-se para começar a partida.');
    const stake = this.config.stake;
    const wallet = this.deps.wallet;
    for (const h of humans) {
      if (wallet.balance(h.userId) < stake) fail(`${h.name} não tem fichas suficientes para a aposta de ${stake}.`);
    }
    wallet.lockEscrowMany(this.id, humans.map((h) => ({ userId: h.userId, amount: stake })), `stake:${this.gameId}`);
    // completa as vagas com bots
    const added: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      if (!this.seats[i]) {
        this.seats[i] = this.newBot();
        added.push(i);
      }
    }
    let r: StepResult<any>;
    try {
      r = this.match.create(this.config, this.seats.map((s) => this.asPlayer(s!)), this.ctx());
    } catch (e) {
      this.deps.log(`[${this.id}] create falhou`, e);
      for (const i of added) this.seats[i] = null;
      for (const h of humans) wallet.releaseEscrow(h.userId, this.id, stake, 'stake-refund');
      fail('Erro ao iniciar a partida.');
    }
    this.lastResult = null;
    this.status = 'playing';
    this.failCount.clear();
    this.sysChat('A partida começou!');
    this.applyStep(r);
    this.broadcastState();
    for (const h of humans) this.deps.pushMe(h.userId);
  }

  private finishMatch(res: MatchResult) {
    this.clearAdvance();
    this.clearTurnTimers();
    const wallet = this.deps.wallet;
    const stake = this.config.stake;
    const pot = stake * this.seats.length;
    const winners = [...new Set(res.winners)].filter((w) => Number.isInteger(w) && w >= 0 && w < this.seats.length);
    const each = winners.length ? Math.floor(pot / winners.length) : 0;
    const rest = winners.length ? pot - each * winners.length : 0;
    const payout = new Map<number, number>();
    winners.forEach((w, i) => payout.set(w, each + (i === 0 ? rest : 0)));

    const paid: string[] = [];
    wallet.db.tx(() => {
      this.seats.forEach((slot, seat) => {
        if (!slot || slot.isBot) return;
        // sem vencedores (empate total): devolve a aposta
        const amount = winners.length ? (payout.get(seat) ?? 0) : stake;
        wallet.releaseEscrow(slot.userId, this.id, amount, amount > 0 ? `match-payout:${this.gameId}` : `match-loss:${this.gameId}`);
        wallet.addHistory(slot.userId, { gameId: this.gameId, roomName: this.name, net: amount - stake, summary: res.summary });
        wallet.addStats(slot.userId, { played: 1, wins: winners.includes(seat) ? 1 : 0 });
        paid.push(slot.userId);
      });
    });
    this.lastResult = { summary: res.summary, winners, payoutEach: each };
    this.status = 'waiting';
    this.sysChat(res.summary);
    // humanos que caíram durante a partida saem agora
    for (const m of [...this.members.values()]) {
      if (m.dropPending && !m.connected) this.removeMember(m.userId, 'Você foi desconectado da sala.');
    }
    if (this.closed) return;
    this.broadcastState();
    for (const id of paid) this.deps.pushMe(id);
  }

  // ---------- orquestração do motor ----------
  private engineCall<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      this.deps.log(`[${this.id}] erro no motor ${this.gameId}`, e);
      fail('Erro interno do jogo.');
    }
  }

  playerAction(userId: string, action: unknown) {
    const seat = this.seatOf(userId);
    if (seat === null) fail('Você não está sentado.');
    if (this.state === null || (this.economy === 'match' && this.status !== 'playing')) fail('A partida não está em andamento.');
    const out = this.safeApply(seat, action);
    if (isEngineError(out)) fail(out.error);
    const m = this.members.get(userId);
    if (m) m.timeouts = 0;
    this.failCount.delete(seat);
    this.applyStep(out, seat);
  }

  private safeApply(seat: number, action: unknown): StepResult<any> | { error: string } {
    try {
      return this.engine.applyAction(this.state, seat, action as never, this.ctx());
    } catch (e) {
      this.deps.log(`[${this.id}] applyAction lançou erro`, e);
      return { error: 'Erro interno do jogo.' };
    }
  }

  private applyStep(r: StepResult<any>, acted?: number) {
    this.state = r.state;
    if (r.advanceInMs !== undefined) this.scheduleAdvance(r.advanceInMs);
    this.afterStep(r.events, acted);
  }

  private scheduleAdvance(ms: number) {
    this.clearAdvance();
    this.advanceTimer = this.timer(ms, () => this.onAdvance());
  }

  private clearAdvance() {
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = null;
  }

  private onAdvance() {
    this.advanceTimer = null;
    if (this.closed || this.state === null) return;
    let r: StepResult<any>;
    try {
      r = this.engine.advance(this.state, this.ctx());
    } catch (e) {
      this.deps.log(`[${this.id}] advance lançou erro`, e);
      return;
    }
    this.applyStep(r);
  }

  private afterStep(events: GameEvent[] | undefined, acted?: number) {
    if (this.closed || this.closing) return;
    if (acted !== undefined) this.clearTurnTimer(acted);

    if (this.economy === 'match' && this.status === 'playing') {
      let res: MatchResult | null = null;
      try {
        res = this.match.getResult(this.state);
      } catch (e) {
        this.deps.log(`[${this.id}] getResult lançou erro`, e);
      }
      if (res) {
        this.finishMatch(res);
        if (this.closed) return;
        this.broadcastView();
        if (events?.length) this.sendAll('game:events', { roomId: this.id, events });
        return;
      }
    }
    if (this.economy === 'session') {
      this.syncEscrow();
      this.rebuyBots();
    }
    this.ensureTurnTimers();
    this.broadcastView();
    if (events?.length) this.sendAll('game:events', { roomId: this.id, events });
    if (this.economy === 'session') this.updateSessionStatus();
  }

  private updateSessionStatus() {
    const playing = this.currentTurn().seats.length > 0 || this.advanceTimer !== null;
    const next: RoomStatus = playing ? 'playing' : 'waiting';
    if (next !== this.status) {
      this.status = next;
      this.broadcastState();
    }
  }

  /** Mantém o escrow igual às fichas na mesa: se o servidor cair, o jogador recupera o que tinha. */
  private syncEscrow() {
    let stacks: Record<number, number>;
    try {
      stacks = this.session.getStacks(this.state);
    } catch (e) {
      this.deps.log(`[${this.id}] getStacks lançou erro`, e);
      return;
    }
    const items: { userId: string; amount: number }[] = [];
    this.seats.forEach((s, i) => {
      if (!s || s.isBot) return;
      const v = stacks[i];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) items.push({ userId: s.userId, amount: Math.floor(v) });
    });
    if (items.length) this.deps.wallet.syncEscrow(this.id, items);
  }

  /** Bots sem fichas recebem nova entrada virtual (se o motor aceitar) */
  private rebuyBots() {
    let stacks: Record<number, number>;
    try {
      stacks = this.session.getStacks(this.state);
    } catch {
      return;
    }
    this.seats.forEach((s, i) => {
      if (!s || !s.isBot || (stacks[i] ?? 0) > 0) return;
      try {
        const r = this.session.addChips(this.state, i, this.config.maxBuyIn, this.ctx());
        if (!isEngineError(r)) {
          this.state = r.state;
          if (r.advanceInMs !== undefined) this.scheduleAdvance(r.advanceInMs);
        }
      } catch {
        /* tenta no próximo passo */
      }
    });
  }

  // ---------- turnos ----------
  private currentTurn(): TurnInfo {
    if (this.state === null || (this.economy === 'match' && this.status !== 'playing')) return { seats: [], timeoutMs: 0 };
    try {
      const t = this.engine.getTurn(this.state);
      return { seats: [...t.seats], timeoutMs: t.timeoutMs };
    } catch (e) {
      this.deps.log(`[${this.id}] getTurn lançou erro`, e);
      return { seats: [], timeoutMs: 0 };
    }
  }

  private clearTurnTimer(seat: number) {
    const t = this.turnTimers.get(seat);
    if (t) clearTimeout(t.handle);
    this.turnTimers.delete(seat);
  }

  private clearTurnTimers() {
    for (const t of this.turnTimers.values()) clearTimeout(t.handle);
    this.turnTimers.clear();
  }

  private ensureTurnTimers() {
    if (this.closed) return;
    const turn = this.currentTurn();
    const want = new Set(turn.seats);
    for (const seat of [...this.turnTimers.keys()]) if (!want.has(seat)) this.clearTurnTimer(seat);
    for (const seat of turn.seats) this.ensureTimer(seat, turn.timeoutMs);
  }

  private ensureTimer(seat: number, timeoutMs: number) {
    const slot = this.seats[seat];
    if (!slot) return;
    const existing = this.turnTimers.get(seat);
    if (existing?.kind === 'retry') return;
    const connected = !slot.isBot && !!this.members.get(slot.userId)?.connected;
    const kind: TurnTimer['kind'] = slot.isBot ? 'bot' : connected ? 'human' : 'disc';
    if (existing && existing.kind === kind) return;
    if (existing) clearTimeout(existing.handle);
    const now = Date.now();
    const base = existing?.base ?? now + timeoutMs;
    let deadline: number | null;
    let delay: number;
    if (kind === 'bot') {
      deadline = null;
      delay = BOT_DELAY_MIN + Math.floor(this.deps.rand() * BOT_DELAY_SPAN);
    } else if (kind === 'human') {
      // Sala "sem limite": humano conectado joga no próprio tempo (sem timer)
      if (this.noTimeLimit) {
        if (existing) this.turnTimers.delete(seat);
        return;
      }
      deadline = existing ? Math.max(base, now + 2000) : base;
      delay = deadline - now;
    } else if (this.noTimeLimit) {
      // desconectado em sala sem limite: espera um pouco a reconexão antes de jogar por ele
      deadline = now + NO_LIMIT_DISCONNECTED_MS;
      delay = NO_LIMIT_DISCONNECTED_MS;
    } else {
      deadline = Math.max(now, Math.min(base, now + DISCONNECTED_TURN_MS));
      delay = deadline - now;
    }
    const handle = this.timer(delay, () => this.onTurnTimer(seat));
    this.turnTimers.set(seat, { kind, handle, deadline, base });
  }

  private onTurnTimer(seat: number) {
    const t = this.turnTimers.get(seat);
    this.turnTimers.delete(seat);
    if (this.closed || !t) return;
    const slot = this.seats[seat];
    const turn = this.currentTurn();
    if (!slot || !turn.seats.includes(seat)) {
      this.ensureTurnTimers();
      return;
    }
    const isBotTimer = t.kind === 'bot' && slot.isBot;
    let out: StepResult<any> | { error: string } = { error: 'sem ação' };
    try {
      const action = isBotTimer
        ? this.engine.botAction(this.state, seat, this.ctx())
        : this.engine.timeoutAction(this.state, seat);
      out = this.safeApply(seat, action);
    } catch (e) {
      this.deps.log(`[${this.id}] ação automática lançou erro`, e);
    }
    if (isEngineError(out) && isBotTimer) {
      try {
        out = this.safeApply(seat, this.engine.timeoutAction(this.state, seat));
      } catch (e) {
        this.deps.log(`[${this.id}] timeoutAction lançou erro`, e);
      }
    }
    if (isEngineError(out)) {
      const n = (this.failCount.get(seat) ?? 0) + 1;
      this.failCount.set(seat, n);
      this.deps.log(`[${this.id}] ação automática inválida (assento ${seat}, tentativa ${n}): ${out.error}`);
      if (n <= 3) {
        const handle = this.timer(5000, () => this.onTurnTimer(seat));
        this.turnTimers.set(seat, { kind: 'retry', handle, deadline: null, base: Date.now() });
      }
      return;
    }
    this.failCount.delete(seat);
    const userId = slot.userId;
    this.applyStep(out, seat);
    if (slot.isBot) return;
    // config.onTimeout = 1: quem estoura o tempo (estando conectado) sai da mesa
    if (t.kind === 'human' && this.config.onTimeout === 1) {
      const name = this.members.get(userId)?.name ?? '?';
      try {
        this.standUser(userId);
        this.send(userId, 'notice', { kind: 'info', text: 'Seu tempo acabou e você saiu da mesa.' });
        this.sysChat(`${name} não jogou a tempo e saiu da mesa.`);
      } catch (e) {
        this.deps.log(`[${this.id}] erro ao tirar da mesa por tempo`, e);
      }
      return;
    }
    this.registerTimeout(userId);
  }

  /** Sala criada com "Sem limite" de tempo por jogada */
  private get noTimeLimit(): boolean {
    return this.config.turnSeconds === 0;
  }

  private registerTimeout(userId: string) {
    if (this.economy !== 'session') return;
    const m = this.members.get(userId);
    if (!m || this.seatOf(userId) === null) return;
    m.timeouts++;
    if (m.timeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
      m.timeouts = 0;
      try {
        this.standUser(userId);
        this.send(userId, 'notice', { kind: 'info', text: 'Você foi levantado da mesa por inatividade.' });
        this.sysChat(`${m.name} foi levantado da mesa por inatividade.`);
      } catch (e) {
        this.deps.log(`[${this.id}] erro ao levantar por inatividade`, e);
      }
    }
  }

  // ---------- visões ----------
  private deadlineFor(seat: number | null): number | null {
    if (seat !== null) {
      const own = this.turnTimers.get(seat);
      if (own && own.deadline !== null) return own.deadline;
    }
    let min: number | null = null;
    for (const t of this.turnTimers.values()) {
      if (t.deadline !== null && (min === null || t.deadline < min)) min = t.deadline;
    }
    return min;
  }

  private sendView(userId: string, seq: number, turn: TurnInfo) {
    const seat = this.seatOf(userId);
    let view: unknown = null;
    try {
      view = this.engine.getView(this.state, seat);
    } catch (e) {
      this.deps.log(`[${this.id}] getView lançou erro`, e);
    }
    this.send(userId, 'game:view', {
      roomId: this.id,
      view,
      mySeat: seat,
      turn: { seats: turn.seats, deadline: this.deadlineFor(seat) },
      seq,
    });
  }

  private broadcastView() {
    if (this.state === null || this.closed) return;
    const seq = ++this.seq;
    const turn = this.currentTurn();
    for (const m of this.members.values()) this.sendView(m.userId, seq, turn);
  }

  // ---------- encerramento ----------
  close(reason: string) {
    if (this.closed) return;
    this.closing = true;
    this.clearAdvance();
    this.clearTurnTimers();
    const wallet = this.deps.wallet;
    // devolve fichas
    for (let seat = 0; seat < this.seats.length; seat++) {
      const slot = this.seats[seat];
      if (!slot || slot.isBot) continue;
      try {
        if (this.economy === 'session') {
          this.standUser(slot.userId);
        } else {
          if (this.status === 'playing') {
            wallet.releaseEscrow(slot.userId, this.id, wallet.escrowAmount(slot.userId, this.id), 'match-refund');
          }
          this.seats[seat] = null;
        }
      } catch (e) {
        this.deps.log(`[${this.id}] erro ao devolver fichas de ${slot.name}`, e);
        this.emergencyRelease(slot.userId);
      }
    }
    this.closed = true;
    this.clearAdvance();
    this.clearTurnTimers();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    for (const m of this.members.values()) {
      if (m.discTimer) clearTimeout(m.discTimer);
      this.deps.bind(m.userId, null);
      this.send(m.userId, 'room:left', { roomId: this.id, reason });
      this.deps.pushMe(m.userId);
    }
    this.members.clear();
    this.deps.closed(this);
  }
}
