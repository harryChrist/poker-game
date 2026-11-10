import type { Card, MaybeCard, SeatPlayer } from '@cards/shared';

export type Action =
  | { type: 'bet'; amount: number }
  | { type: 'skip' }
  | { type: 'insurance'; take: boolean }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' };

export type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust';
export type Phase = 'idle' | 'betting' | 'insurance' | 'playing' | 'dealer' | 'result';

export interface BJHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  done: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  outcome: Outcome | null;
  payout: number;
}

export interface RoundEntry {
  seat: number;
  userId: string;
  name: string;
  isBot: boolean;
  hands: BJHand[];
  /** fichas pagas no seguro (0 = não fez) */
  insurance: number;
  insDecided: boolean;
  left: boolean;
  /** ganho/perda líquido da rodada (preenchido no resultado) */
  net: number | null;
}

export interface TableSeat {
  player: SeatPlayer;
  stack: number;
  lastBet: number;
}

export interface State {
  cfg: { seats: number; minBet: number; maxBet: number; decks: number; turnMs: number };
  seats: (TableSeat | null)[];
  phase: Phase;
  shoe: Card[];
  shoeGen: number;
  round: number;
  /** decisões da fase de apostas (amount 0 = pulou) */
  bets: { seat: number; amount: number }[];
  entries: RoundEntry[];
  dealer: Card[];
  dealerHidden: boolean;
  toAct: { seat: number; hand: number } | null;
}

/* ---------------- View ---------------- */

export interface Legal {
  phase: 'betting' | 'insurance' | 'playing';
  /** apostas */
  minBet: number;
  maxBet: number;
  lastBet: number;
  /** seguro */
  insuranceCost: number;
  /** jogada */
  hand: number;
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
}

export interface HandView {
  cards: Card[];
  bet: number;
  total: number;
  soft: boolean;
  /** "17", "soft 17", "BJ", "estourou" */
  label: string;
  isBlackjack: boolean;
  bust: boolean;
  done: boolean;
  doubled: boolean;
  /** é a mão em jogo agora */
  active: boolean;
  outcome: Outcome | null;
  /** ganho líquido da mão no resultado */
  net: number | null;
}

export interface SeatView {
  seat: number;
  userId: string;
  name: string;
  isBot: boolean;
  stack: number;
  lastBet: number;
  /** participa da rodada atual */
  inRound: boolean;
  /** fase de apostas: já decidiu (apostou ou pulou) */
  decided: boolean;
  /** valor apostado na fase de apostas (0 = pulou/ainda não) */
  betPlaced: number;
  hands: HandView[];
  insurance: number;
  insuranceDecided: boolean;
  /** resultado líquido da rodada (só em 'result') */
  net: number | null;
  /** sentado sem fichas para a aposta mínima */
  sittingOut: boolean;
}

export interface DealerView {
  cards: MaybeCard[];
  total: number | null;
  label: string;
  hidden: boolean;
  bust: boolean;
  isBlackjack: boolean;
}

export interface View {
  mySeat: number | null;
  phase: 'waiting' | 'betting' | 'insurance' | 'playing' | 'dealer' | 'result';
  round: number;
  minBet: number;
  maxBet: number;
  seats: (SeatView | null)[];
  dealer: DealerView;
  toAct: { seat: number; hand: number } | null;
  /** assentos que precisam agir agora (apostas/seguro simultâneos) */
  turnSeats: number[];
  /** percentual restante do sapato (0-100) */
  shoePct: number;
  legal: Legal | null;
}
