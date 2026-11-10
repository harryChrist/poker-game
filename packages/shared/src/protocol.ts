import type { GameId } from './games';
import type { GameEvent } from './engine';

/**
 * PROTOCOLO SOCKET.IO
 *
 * Cliente -> servidor: socket.emit(evento, payload, ack). Todo ack recebe Ack<T>.
 * Servidor -> cliente: socket.emit(evento, payload) sem ack.
 *
 * Autenticação: o cliente conecta com `io(url, { auth: { token }, transports: ['websocket'] })`.
 * Sem token válido, só os eventos auth:* funcionam. Ao fazer login/registro o servidor associa
 * o socket ao usuário e devolve o token (guardar e reenviar na reconexão).
 * Reconexão: ao reconectar com token, o servidor reenvia me, room:state e game:view da sala em que o usuário estava.
 */

export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type Role = 'user' | 'admin';

export interface Me {
  id: string;
  username: string;
  role: Role;
  balance: number;
  /** Fichas presas em mesas (buy-ins / apostas de partida em andamento) */
  inPlay: number;
  /** Quando poderá pedir recarga de novo (ms epoch); null = disponível agora (se elegível) */
  refillAvailableAt: number | null;
  /** Quando poderá resgatar o bônus (de hora em hora) de novo; null = disponível agora */
  dailyAvailableAt: number | null;
  /** Id da sala atual (para reconexão) */
  roomId: string | null;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomSummary {
  id: string;
  name: string;
  gameId: GameId;
  isPrivate: boolean;
  hostName: string;
  status: RoomStatus;
  seatsTotal: number;
  seatsTaken: number;
  humans: number;
  /** Texto curto com as apostas, ex.: "Blinds 10/20" ou "Aposta 100" */
  stakesLabel: string;
  createdAt: number;
}

export interface SeatState {
  seat: number;
  userId: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  /** Marcou "pronto" para começar (bots estão sempre prontos) */
  ready: boolean;
}

export interface RoomState {
  id: string;
  /** Código de convite (6 caracteres). Sempre presente; sala privada só aparece no lobby por código. */
  code: string;
  name: string;
  gameId: GameId;
  isPrivate: boolean;
  hostUserId: string;
  status: RoomStatus;
  config: Record<string, number>;
  seats: (SeatState | null)[];
  spectators: { userId: string; name: string }[];
  /** Resultado da última partida (jogos match) */
  lastResult: { summary: string; winners: number[]; payoutEach: number } | null;
  /** Metade+ dos sentados está pronta: o jogo começa sozinho neste instante (ms epoch). null = sem contagem. */
  autoStartAt: number | null;
}

/** Enviado sempre que o estado do jogo muda (personalizado por usuário) */
export interface GameViewMsg {
  roomId: string;
  /** Visão do motor (formato específico de cada jogo) */
  view: unknown;
  mySeat: number | null;
  turn: { seats: number[]; deadline: number | null };
  /** Contador crescente para o cliente descartar mensagens antigas */
  seq: number;
}

export interface GameEventMsg {
  roomId: string;
  events: GameEvent[];
}

export interface ChatMsg {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

export interface RankingEntry {
  userId: string;
  username: string;
  total: number;
  wins: number;
  played: number;
}

export interface HistoryEntry {
  id: string;
  gameId: GameId;
  roomName: string;
  /** Lucro/prejuízo líquido do usuário */
  net: number;
  summary: string;
  endedAt: number;
}

export interface AdminUser {
  id: string;
  username: string;
  role: Role;
  balance: number;
  inPlay: number;
  banned: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
}

export interface CreateRoomInput {
  gameId: GameId;
  name: string;
  isPrivate: boolean;
  config: Record<string, number>;
}

/** Eventos cliente -> servidor: [payload, tipo do data no Ack] */
export interface ClientEvents {
  'auth:register': [{ username: string; password: string }, { token: string; me: Me }];
  'auth:login': [{ username: string; password: string }, { token: string; me: Me }];
  'auth:logout': [{}, undefined];
  'me:get': [{}, Me];
  'wallet:refill': [{}, Me];
  'wallet:daily': [{}, Me];

  'lobby:list': [{ gameId?: GameId }, RoomSummary[]];
  'room:create': [CreateRoomInput, RoomState];
  'room:join': [{ roomId?: string; code?: string }, RoomState];
  'room:leave': [{}, undefined];
  /** Sentar. buyIn obrigatório em jogos session. */
  'room:sit': [{ seat: number; buyIn?: number }, undefined];
  'room:stand': [{}, undefined];
  /** Rebuy em jogos session */
  'room:addChips': [{ amount: number }, undefined];
  /** Host: adicionar/remover bot num assento */
  'room:addBot': [{ seat: number }, undefined];
  'room:removeBot': [{ seat: number }, undefined];
  /** Host: começar partida (jogos match). Assentos vazios são preenchidos com bots. */
  'room:start': [{}, undefined];
  /** Marcar/desmarcar "pronto" antes de começar. O líder só consegue começar com todos os sentados prontos. */
  'room:ready': [{ ready: boolean }, undefined];
  /** Líder: remover alguém da sala (não pode voltar nesta sala). Não vale no meio de uma partida com aposta. */
  'room:kick': [{ userId: string }, undefined];

  'game:action': [{ action: unknown }, undefined];
  'chat:send': [{ text: string }, undefined];

  'ranking:get': [{}, RankingEntry[]];
  'history:get': [{}, HistoryEntry[]];

  'admin:users': [{ search?: string }, AdminUser[]];
  'admin:adjust': [{ userId: string; amount: number }, AdminUser];
  'admin:setRole': [{ userId: string; role: Role }, AdminUser];
  'admin:ban': [{ userId: string; banned: boolean }, AdminUser];
  'admin:resetPassword': [{ userId: string; password: string }, undefined];
  'admin:rooms': [{}, RoomSummary[]];
  'admin:closeRoom': [{ roomId: string }, undefined];
}

/** Eventos servidor -> cliente */
export interface ServerEvents {
  /** Primeira mensagem de toda conexão. buildId = versão da web app no servidor (cliente recarrega se for diferente da dele). */
  'server:hello': { buildId: string | null };
  me: Me;
  'lobby:rooms': RoomSummary[];
  'room:state': RoomState;
  /** Você saiu/foi removido da sala */
  'room:left': { roomId: string; reason?: string };
  'game:view': GameViewMsg;
  'game:events': GameEventMsg;
  'chat:msg': ChatMsg;
  /** Histórico recente do chat ao entrar na sala */
  'chat:history': ChatMsg[];
  /** Mensagem para toast */
  notice: { kind: 'info' | 'error' | 'success'; text: string };
  /** Sessão encerrada (ban, login em outro lugar) */
  kicked: { reason: string };
}

export type ClientEventName = keyof ClientEvents;
export type ServerEventName = keyof ServerEvents;
