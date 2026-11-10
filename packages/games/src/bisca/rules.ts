import type { Card, Rank } from '@cards/shared';
import type { Play, Team } from './types';

/** Do menor para o maior: 2 < 3 < 4 < 5 < 6 < Q < J < K < 7 < A */
export const BISCA_ORDER: Rank[] = ['2', '3', '4', '5', '6', 'Q', 'J', 'K', '7', 'A'];

const POINTS: Partial<Record<Rank, number>> = { A: 11, '7': 10, K: 4, J: 3, Q: 2 };

export const TOTAL_POINTS = 120;

export const cardPoints = (c: Card): number => POINTS[c.r] ?? 0;
export const rankPower = (c: Card): number => BISCA_ORDER.indexOf(c.r);

export const teamOf = (seat: number, n: number): Team => (n === 2 ? (seat as Team) : ((seat % 2) as Team));

/** Vencedor da vaza: maior trunfo; sem trunfo, a maior do naipe de saída. */
export function trickWinner(plays: Play[], trump: string): Play {
  const lead = plays[0].card.s;
  let best = plays[0];
  const beats = (a: Card, b: Card): boolean => {
    const at = a.s === trump;
    const bt = b.s === trump;
    if (at !== bt) return at;
    if (a.s !== b.s) return false; // naipe diferente (sem trunfo): não vence
    return rankPower(a) > rankPower(b);
  };
  for (const p of plays.slice(1)) {
    if (p.card.s !== trump && p.card.s !== lead) continue;
    if (beats(p.card, best.card)) best = p;
  }
  return best;
}

/** Ordem "valor": pontos e depois força (usada para jogar lixo) */
export function cheapFirst(a: Card, b: Card, trump: string): number {
  const ta = a.s === trump ? 1 : 0;
  const tb = b.s === trump ? 1 : 0;
  if (ta !== tb) return ta - tb;
  return cardPoints(a) - cardPoints(b) || rankPower(a) - rankPower(b);
}

/** Carta de menor valor: pontos e depois ordem (usada no timeout) */
export function lowestValue(hand: Card[]): Card {
  return hand.reduce((a, b) => (cardPoints(b) - cardPoints(a) || rankPower(b) - rankPower(a)) < 0 ? b : a);
}

/** Pode `seat` trocar o 2 do trunfo pela carta virada? */
export function canSwapTrump(hand: Card[], stockLen: number, trump: string): Card | null {
  if (stockLen < 2) return null;
  return hand.find((c) => c.r === '2' && c.s === trump) ?? null;
}
