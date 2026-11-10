import { randomInt, randomUUID } from 'node:crypto';
import {
  GAMES, cryptoRng, resolveConfig, seatCount,
  type AnyEngine, type CreateRoomInput, type GameId, type RoomState, type RoomSummary,
} from '@cards/shared';
import { fail } from './config';
import { Room, type Transport } from './room';
import type { Wallet } from './wallet';

export interface ManagerTransport extends Transport {
  /** Usuários com socket conectado (para o push da lista do lobby) */
  onlineUsers(): Iterable<string>;
}

export interface ManagerOptions {
  wallet: Wallet;
  transport: ManagerTransport;
  engines: Record<GameId, AnyEngine>;
  rng?: () => number;
  rand?: () => number;
  log?: (msg: string, err?: unknown) => void;
  maxRooms?: number;
}

export interface RoomUser {
  id: string;
  name: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_THROTTLE_MS = 500;

export function validateRoomConfig(gameId: GameId, config: Record<string, number>) {
  const meta = GAMES[gameId];
  if (!meta.playerCounts.includes(seatCount(gameId, config))) fail('Número de lugares inválido para este jogo.');
  if (gameId === 'poker') {
    if (config.bigBlind <= config.smallBlind) fail('O big blind precisa ser maior que o small blind.');
    if (config.minBuyIn > config.maxBuyIn) fail('A entrada mínima não pode ser maior que a máxima.');
    if (config.minBuyIn < config.bigBlind * 10) fail('A entrada mínima deve ser de pelo menos 10 big blinds.');
  } else if (gameId === 'blackjack') {
    if (config.minBet > config.maxBet) fail('A aposta mínima não pode ser maior que a máxima.');
    if (config.minBuyIn < config.minBet) fail('A entrada mínima deve cobrir pelo menos a aposta mínima.');
    if (config.minBuyIn > config.maxBuyIn) fail('A entrada mínima não pode ser maior que a máxima.');
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private userRoom = new Map<string, Room>();
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  private wallet: Wallet;
  private transport: ManagerTransport;
  private engines: Record<GameId, AnyEngine>;
  private rng: () => number;
  private rand: () => number;
  private log: (msg: string, err?: unknown) => void;
  private maxRooms: number;

  constructor(opts: ManagerOptions) {
    this.wallet = opts.wallet;
    this.transport = opts.transport;
    this.engines = opts.engines;
    this.rng = opts.rng ?? cryptoRng();
    this.rand = opts.rand ?? Math.random;
    this.log = opts.log ?? ((m, e) => console.error(m, e ?? ''));
    this.maxRooms = opts.maxRooms ?? 300;
  }

  // ---------- consulta ----------
  roomOf(userId: string): Room | null {
    return this.userRoom.get(userId) ?? null;
  }
  roomIdOf(userId: string): string | null {
    return this.userRoom.get(userId)?.id ?? null;
  }
  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }
  get count() {
    return this.rooms.size;
  }
  isInPlay(userId: string): boolean {
    return this.userRoom.get(userId)?.isInPlay(userId) ?? false;
  }

  listPublic(gameId?: GameId): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate && (!gameId || r.gameId === gameId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => r.summary());
  }

  listAll(): RoomSummary[] {
    return [...this.rooms.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => r.summary());
  }

  // ---------- lobby ----------
  markLobbyDirty() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      this.pushLobby();
    }, LOBBY_THROTTLE_MS);
    (this.lobbyTimer as any).unref?.();
  }

  private pushLobby() {
    let list: RoomSummary[] | null = null;
    for (const uid of this.transport.onlineUsers()) {
      if (this.userRoom.has(uid)) continue;
      list ??= this.listPublic();
      try {
        this.transport.send(uid, 'lobby:rooms', list);
      } catch (e) {
        this.log('falha ao enviar lobby:rooms', e);
      }
    }
  }

  // ---------- salas ----------
  private makeCode(): string {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let j = 0; j < 6; j++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (![...this.rooms.values()].some((r) => r.code === c)) return c;
    }
    fail('Não foi possível gerar um código de convite.');
  }

  createRoom(user: RoomUser, input: CreateRoomInput): RoomState {
    const gameId = input.gameId;
    if (!GAMES[gameId]) fail('Jogo inválido.');
    const name = String(input.name ?? '').trim();
    if (name.length < 1 || name.length > 30) fail('Dê um nome à sala (até 30 caracteres).');
    const config = resolveConfig(gameId, input.config);
    validateRoomConfig(gameId, config);
    if (this.rooms.size >= this.maxRooms) fail('O servidor atingiu o limite de salas. Tente mais tarde.');

    this.leave(user.id);
    const room = new Room(this.roomDeps(), {
      id: randomUUID(),
      code: this.makeCode(),
      name,
      gameId,
      isPrivate: !!input.isPrivate,
      config,
      host: { userId: user.id, name: user.name },
      engine: this.engines[gameId],
    });
    this.rooms.set(room.id, room);
    room.addMember(user.id, user.name);
    this.markLobbyDirty();
    return room.toState();
  }

  private roomDeps() {
    return {
      wallet: this.wallet,
      transport: this.transport,
      rng: this.rng,
      rand: this.rand,
      log: this.log,
      bind: (userId: string, room: Room | null) => {
        if (room) this.userRoom.set(userId, room);
        else this.userRoom.delete(userId);
      },
      changed: () => this.markLobbyDirty(),
      closed: (room: Room) => {
        this.rooms.delete(room.id);
        this.markLobbyDirty();
      },
      pushMe: (userId: string) => this.pushMe(userId),
    };
  }

  pushMe(userId: string) {
    try {
      this.transport.send(userId, 'me', this.wallet.buildMe(userId, this.roomIdOf(userId)));
    } catch (e) {
      this.log('falha ao enviar me', e);
    }
  }

  join(user: RoomUser, input: { roomId?: string; code?: string }): RoomState {
    let room: Room | undefined;
    if (input.code) {
      const code = input.code.trim().toUpperCase();
      room = [...this.rooms.values()].find((r) => r.code === code);
    } else if (input.roomId) {
      room = this.rooms.get(input.roomId);
      if (room?.isPrivate && !room.hasMember(user.id)) room = undefined;
    } else {
      fail('Informe a sala ou o código de convite.');
    }
    if (!room || room.closed) fail('Sala não encontrada.');
    if (room.hasMember(user.id)) {
      room.setConnected(user.id, true);
      return room.toState();
    }
    this.leave(user.id);
    room.addMember(user.id, user.name);
    this.pushMe(user.id);
    return room.toState();
  }

  leave(userId: string) {
    this.userRoom.get(userId)?.removeMember(userId);
  }

  private mine(userId: string): Room {
    const r = this.userRoom.get(userId);
    if (!r) fail('Você não está em nenhuma sala.');
    return r;
  }

  sit(userId: string, seat: number, buyIn?: number) {
    this.mine(userId).sit(userId, seat, buyIn);
  }
  stand(userId: string) {
    this.mine(userId).stand(userId);
  }
  addChips(userId: string, amount: number) {
    this.mine(userId).addChips(userId, amount);
  }
  addBot(userId: string, seat: number) {
    this.mine(userId).addBot(userId, seat);
  }
  removeBot(userId: string, seat: number) {
    this.mine(userId).removeBot(userId, seat);
  }
  start(userId: string) {
    this.mine(userId).start(userId);
  }
  action(userId: string, action: unknown) {
    this.mine(userId).playerAction(userId, action);
  }
  chat(userId: string, text: string) {
    this.mine(userId).chat(userId, text);
  }

  // ---------- conexão ----------
  onConnect(userId: string) {
    this.userRoom.get(userId)?.setConnected(userId, true);
  }
  onDisconnect(userId: string) {
    this.userRoom.get(userId)?.setConnected(userId, false);
  }

  // ---------- admin / encerramento ----------
  closeRoom(roomId: string, reason: string) {
    const room = this.rooms.get(roomId);
    if (!room) fail('Sala não encontrada.');
    room.close(reason);
  }

  /** Fecha todas as salas devolvendo fichas (shutdown) */
  shutdown(reason = 'O servidor está reiniciando.') {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = null;
    for (const room of [...this.rooms.values()]) {
      try {
        room.close(reason);
      } catch (e) {
        this.log(`erro ao fechar sala ${room.id}`, e);
      }
    }
  }
}
