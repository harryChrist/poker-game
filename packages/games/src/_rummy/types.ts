import type { Card, Rank, SeatPlayer } from '@cards/shared';

export type RummyGame = 'cacheta' | 'pife';

export type RummyAction =
  /** Comprar 1 carta do monte ou pegar o topo do descarte (início do turno) */
  | { type: 'draw'; from: 'deck' | 'discard' }
  /** Descartar 1 carta (fim do turno, depois de comprar) */
  | { type: 'discard'; cardId: string }
  /** Bater: descarta `discardId` e as outras cartas precisam formar só jogos válidos. null = bater com as 10 em jogos, sem descartar. */
  | { type: 'knock'; discardId: string | null }
  /** Reorganizar a própria mão (não gasta a vez; vale a qualquer momento da rodada) */
  | { type: 'reorder'; cardIds: string[] };

export type RummyPhase = 'play' | 'roundEnd' | 'over';

export interface RevealHand {
  seat: number;
  /** Mão inteira, jogos primeiro e soltas depois */
  cards: Card[];
  groups: Card[][];
  loose: Card[];
  knocker: boolean;
  /** Variação nesta rodada: -1 vida (cacheta), +1 vitória (pife) ou 0 */
  delta: number;
  /** Placar depois da rodada (vidas ou vitórias) */
  score: number;
  /** Ficou sem vidas nesta rodada (cacheta) */
  eliminated: boolean;
}

export interface Reveal {
  kind: 'knock' | 'void';
  knocker: number | null;
  /** Carta descartada ao bater (null se bateu com as 10 ou rodada anulada) */
  discarded: Card | null;
  hands: RevealHand[];
  text: string;
}

export interface RummyState {
  game: RummyGame;
  config: { turnSeconds: number; lives: number; targetWins: number };
  players: SeatPlayer[];
  /** Mãos por assento (vazia para quem está fora) */
  hands: Card[][];
  /** Monte: o topo é o ÚLTIMO elemento */
  deck: Card[];
  /** Descarte: o topo é o ÚLTIMO elemento */
  discard: Card[];
  vira: Card | null;
  wildRank: Rank | null;
  dealer: number;
  turn: number;
  step: 'draw' | 'discard';
  /** Carta comprada neste turno (destaque na mão do jogador da vez) */
  drawnId: string | null;
  drawnFromDiscard: boolean;
  round: number;
  phase: RummyPhase;
  /** Vidas (cacheta) ou vitórias (pife) */
  scores: number[];
  alive: boolean[];
  /** Quantas vezes o monte foi reembaralhado nesta rodada */
  reshuffles: number;
  reveal: Reveal | null;
  winners: number[] | null;
  summary: string | null;
}

export interface RummyPlayerView {
  seat: number;
  name: string;
  isBot: boolean;
  handCount: number;
  /** Vidas (cacheta) ou vitórias (pife) */
  score: number;
  /** Ainda na partida (sempre true no pife) */
  alive: boolean;
}

export interface RummyView {
  game: RummyGame;
  phase: RummyPhase;
  /** Assento a quem esta visão pertence (null = espectador) */
  seat: number | null;
  /** Assento da vez (null fora do jogo) */
  turnSeat: number | null;
  /** O que o jogador da vez precisa fazer: comprar ou descartar/bater */
  turnStep: 'draw' | 'discard' | null;
  dealer: number;
  round: number;
  /** 'lives' = cacheta, 'wins' = pife */
  scoreKind: 'lives' | 'wins';
  /** Vidas iniciais (cacheta) ou vitórias para fechar (pife) */
  target: number;
  players: RummyPlayerView[];
  /** Minha mão, na ordem em que o jogador organizou ([] para espectador ou quem está fora) */
  hand: Card[];
  /** Melhor divisão da minha mão em jogos (ids); jogos já ordenados */
  arrangement: { groups: string[][]; loose: string[] } | null;
  /** Carta que acabei de comprar neste turno (só para o dono da vez) */
  drawnId: string | null;
  discardTop: Card | null;
  discardCount: number;
  deckCount: number;
  /** Cacheta: carta virada e valor dos coringas */
  vira: Card | null;
  wildRank: Rank | null;
  legal: {
    drawDeck: boolean;
    drawDiscard: boolean;
    /** Cartas que posso descartar agora (turno de descartar) */
    discards: string[];
    /** Posso bater agora */
    knock: boolean;
    /** Descartes que permitem bater (a melhor sugestão primeiro) */
    knockDiscards: string[];
    /** Posso bater sem descartar (as 10 cartas já formam jogos) */
    knockAll: boolean;
  };
  /** Fim da rodada: mãos reveladas */
  reveal: Reveal | null;
  /** Fim da partida */
  result: { winners: number[]; summary: string } | null;
}
