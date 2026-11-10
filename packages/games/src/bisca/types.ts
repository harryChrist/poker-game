import type { Card, Rank, SeatPlayer, Suit } from '@cards/shared';

export type Team = 0 | 1;
export type Phase = 'play' | 'pause' | 'over';

export interface Play {
  seat: number;
  card: Card;
}

export interface TrickInfo {
  winnerSeat: number;
  points: number;
  plays: Play[];
}

export interface GameResult {
  /** null = empate 60 x 60 (jogo não conta) */
  winnerTeam: Team | null;
  points: [number, number];
  text: string;
}

export interface BiscaState {
  n: number;
  turnMs: number;
  targetWins: number;
  players: SeatPlayer[];
  /** monte; a última carta é o trunfo virado (a última a ser comprada) */
  stock: Card[];
  trumpSuit: Suit;
  hands: Card[][];
  table: Play[];
  /** quem abriu a vaza atual */
  leader: number;
  turnSeat: number | null;
  /** pontos do jogo atual, por time */
  points: [number, number];
  /** jogos vencidos, por time */
  wins: [number, number];
  gameNo: number;
  firstSeat: number;
  lastTrick: TrickInfo | null;
  nextLeader: number | null;
  gameResult: GameResult | null;
  phase: Phase;
  pause: 'trick' | 'game' | null;
  winnerTeam: Team | null;
}

export type Action = { type: 'play'; cardId: string } | { type: 'swapTrump' };

export interface Legal {
  cards: string[];
  canSwap: boolean;
}

export interface BiscaView {
  n: number;
  mySeat: number | null;
  myTeam: Team;
  players: { name: string; isBot: boolean }[];
  phase: 'play' | 'trickEnd' | 'gameEnd' | 'over';
  trumpSuit: Suit;
  /** trunfo virado ainda no monte (null quando já foi comprado) */
  trumpCard: Card | null;
  stockCount: number;
  myHand: Card[];
  handCounts: number[];
  table: Play[];
  leader: number;
  turnSeat: number | null;
  points: [number, number];
  wins: [number, number];
  targetWins: number;
  gameNo: number;
  lastTrick: { winnerSeat: number; points: number } | null;
  gameResult: GameResult | null;
  winnerTeam: Team | null;
  legal: Legal | null;
}

export type { Rank };
