import type { Card, MaybeCard, Rank, SeatPlayer } from '@cards/shared';

export type Team = 0 | 1;
export type Phase = 'decide11' | 'play' | 'respond' | 'pause' | 'over';
export type Mode = 'normal' | 'onze' | 'ferro';

export interface Play {
  seat: number;
  card: Card;
  /** jogada encoberta (vale zero) */
  hidden: boolean;
}

export interface TrickRec {
  plays: Play[];
  winnerSeat: number | null;
  winnerTeam: Team | null;
}

export type HandReason = 'tricks' | 'run' | 'run11' | 'tie';

export interface HandResult {
  winnerTeam: Team | null;
  points: number;
  reason: HandReason;
  text: string;
}

export interface TrucoState {
  n: number;
  turnMs: number;
  players: SeatPlayer[];
  scores: [number, number];
  /** "mão": quem começa a 1ª vaza da mão atual */
  handSeat: number;
  handNo: number;
  hands: Card[][];
  vira: Card;
  manilha: Rank;
  mode: Mode;
  onzeTeam: Team | null;
  /** valor aceito da mão (1, 3, 6, 9, 12) */
  value: number;
  /** valor pedido aguardando resposta */
  pendingValue: number | null;
  lastRequestTeam: Team | null;
  requestSeat: number | null;
  /** quem precisa responder (truco ou decisão de onze) */
  respondSeat: number | null;
  /** de quem é a vez de jogar carta */
  turnSeat: number | null;
  table: Play[];
  tricks: TrickRec[];
  nextLeader: number | null;
  phase: Phase;
  pause: 'trick' | 'hand' | null;
  handResult: HandResult | null;
  winnerTeam: Team | null;
}

export type Action =
  | { type: 'play'; cardId?: string; index?: number; hidden?: boolean }
  | { type: 'truco' }
  | { type: 'accept' }
  | { type: 'run' }
  | { type: 'raise' }
  | { type: 'play11' }
  | { type: 'run11' };

export type Legal =
  | {
      kind: 'play';
      /** ids jogáveis (vazio na mão de ferro: use o índice) */
      cards: string[];
      /** mão de ferro: as cartas são escolhidas pelo índice */
      byIndex: boolean;
      canHide: boolean;
      canTruco: boolean;
      /** TRUCO / SEIS / NOVE / DOZE */
      trucoLabel: string | null;
      trucoValue: number | null;
    }
  | {
      kind: 'respond';
      pendingValue: number;
      /** pontos que o adversário marca se você correr */
      runPoints: number;
      canRaise: boolean;
      raiseLabel: string | null;
      raiseValue: number | null;
    }
  | { kind: 'decide11' };

export interface TrucoView {
  n: number;
  mySeat: number | null;
  /** time do usuário (espectador = 0) */
  myTeam: Team;
  players: { name: string; isBot: boolean }[];
  scores: [number, number];
  phase: 'play' | 'respond' | 'decide11' | 'trickEnd' | 'handEnd' | 'over';
  mode: Mode;
  onzeTeam: Team | null;
  handSeat: number;
  vira: Card;
  manilha: Rank;
  value: number;
  pendingValue: number | null;
  requestSeat: number | null;
  respondSeat: number | null;
  turnSeat: number | null;
  /** minha mão (HiddenCard sem id na mão de ferro) */
  myHand: MaybeCard[];
  /** cartas do parceiro, só visível na decisão da mão de onze (2x2) */
  partnerHand: Card[] | null;
  handCounts: number[];
  table: { seat: number; card: MaybeCard }[];
  tricks: { winnerSeat: number | null; winnerTeam: Team | null; plays: { seat: number; card: MaybeCard }[] }[];
  /** resultado de cada vaza do ponto de vista do usuário */
  trickDots: ('me' | 'opp' | 'tie')[];
  handResult: HandResult | null;
  winnerTeam: Team | null;
  legal: Legal | null;
}
