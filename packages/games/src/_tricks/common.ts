/** Helpers compartilhados entre os jogos de vaza (sueca, copas, fodinha). */
import type { Card, HiddenCard, Rank, SeatPlayer, Suit } from '@cards/shared';

export interface PublicPlayer {
  name: string;
  isBot: boolean;
}

export interface Play {
  seat: number;
  card: Card;
}

export function publicPlayers(players: SeatPlayer[]): PublicPlayer[] {
  return players.map((p) => ({ name: p.name, isBot: p.isBot }));
}

export function withBot(players: SeatPlayer[], seat: number, botName: string): SeatPlayer[] {
  return players.map((p, i) => (i === seat ? { userId: `bot-${seat}`, name: botName, isBot: true } : p));
}

export function nextSeat(seat: number, n: number): number {
  return (seat + 1) % n;
}

export function hiddenCards(n: number): HiddenCard[] {
  return Array.from({ length: n }, () => ({ hidden: true as const }));
}

/** Ordena a mão por naipe (alternando cores) e depois por força crescente. */
export function sortHand(cards: Card[], rankOrder: readonly Rank[], suitOrder: readonly Suit[] = ['S', 'H', 'C', 'D']): Card[] {
  return cards.slice().sort((a, b) => {
    const ds = suitOrder.indexOf(a.s) - suitOrder.indexOf(b.s);
    if (ds !== 0) return ds;
    return rankOrder.indexOf(a.r) - rankOrder.indexOf(b.r);
  });
}

export function without(cards: Card[], id: string): Card[] {
  return cards.filter((c) => c.id !== id);
}

export function findCard(cards: Card[], id: unknown): Card | undefined {
  if (typeof id !== 'string') return undefined;
  return cards.find((c) => c.id === id);
}

/** Distribui `perHand` cartas para cada um dos `n` assentos, começando em `first`, uma por vez. */
export function dealRoundRobin(deck: Card[], n: number, perHand: number, first: number): Card[][] {
  const hands: Card[][] = Array.from({ length: n }, () => []);
  let k = 0;
  for (let i = 0; i < perHand * n; i++) hands[(first + i) % n].push(deck[k++]);
  return hands;
}
