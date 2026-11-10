import type { Card, MaybeCard, SeatPlayer } from '@cards/shared';

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** `to` = aposta total do jogador na rodada atual (serve também para "bet") */
  | { type: 'raise'; to: number }
  | { type: 'allin' };

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Phase = 'idle' | 'betting' | 'reveal' | 'result';

export interface TableSeat {
  player: SeatPlayer;
  stack: number;
  /** fichas adicionadas (rebuy) durante a mão, aplicadas na próxima */
  pending: number;
}

/** Participante da mão atual (independe de o jogador continuar sentado) */
export interface HandPlayer {
  seat: number;
  userId: string;
  name: string;
  isBot: boolean;
  cards: Card[];
  /** aposta na rodada atual */
  bet: number;
  /** total investido na mão */
  total: number;
  folded: boolean;
  allIn: boolean;
  /** valor da aposta atual no momento da última ação (null = ainda não agiu na rodada) */
  actedAt: number | null;
  /** levantou da mesa durante a mão */
  left: boolean;
  /** descrição da última ação (para a tela) */
  last: string;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
  /** pote de um jogador só (aposta não igualada devolvida) */
  refund: boolean;
  handName?: string;
}

export interface ShowdownHand {
  seat: number;
  handName: string;
  category: number;
  /** ids das 5 cartas da melhor mão */
  best: string[];
}

export interface HandResult {
  showdown: boolean;
  total: number;
  pots: PotResult[];
  winners: { seat: number; name: string; amount: number; handName?: string }[];
  hands: ShowdownHand[];
}

export interface State {
  cfg: { seats: number; sb: number; bb: number; turnMs: number };
  seats: (TableSeat | null)[];
  phase: Phase;
  button: number;
  handNo: number;
  hand: HandPlayer[];
  deck: Card[];
  board: Card[];
  street: Street;
  toAct: number;
  currentBet: number;
  /** tamanho do último aumento completo (mínimo = big blind) */
  lastRaise: number;
  sbSeat: number;
  bbSeat: number;
  /** ninguém mais pode apostar: o board é aberto até o fim */
  runout: boolean;
  result: HandResult | null;
}

/* ---------------- View ---------------- */

export interface Legal {
  check: boolean;
  /** fichas a pagar (já limitado ao stack); null = não pode pagar (use check) */
  call: number | null;
  toCall: number;
  /** valores "para" (aposta total na rodada). half/pot já limitados a [min, max]. */
  raise: { min: number; max: number; half: number; pot: number } | null;
  /** aposta total ao dar all-in; null = não permitido */
  allin: number | null;
  pot: number;
}

export interface SeatView {
  seat: number;
  userId: string;
  name: string;
  isBot: boolean;
  stack: number;
  pending: number;
  /** aposta na rodada (fichas na frente do jogador) */
  bet: number;
  total: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** sentado sem fichas, fora das próximas mãos */
  sittingOut: boolean;
  /** sentado com fichas, esperando a próxima mão */
  waiting: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  cards: MaybeCard[];
  last: string;
  /** showdown: nome da mão e ids da melhor mão */
  handName?: string;
  bestIds?: string[];
  /** resultado: quanto ganhou */
  won?: number;
}

export interface ResultView {
  showdown: boolean;
  total: number;
  pots: PotResult[];
  winners: { seat: number; name: string; amount: number; handName?: string }[];
}

export interface View {
  mySeat: number | null;
  phase: 'waiting' | 'betting' | 'between' | 'runout' | 'result';
  street: Street;
  handNo: number;
  smallBlind: number;
  bigBlind: number;
  seats: (SeatView | null)[];
  board: Card[];
  /** pote total (inclui apostas da rodada) */
  pot: number;
  /** potes separados (principal + laterais) quando há mais de um disputável */
  pots: number[];
  button: number;
  turnSeat: number | null;
  currentBet: number;
  /** cartas dos jogadores à mostra (showdown ou all-in) */
  showdown: boolean;
  /** ações válidas — só para o assento na vez */
  legal: Legal | null;
  result: ResultView | null;
  /** ids das cartas (comunitárias e de mão) que formam as mãos vencedoras */
  winningIds: string[];
}
