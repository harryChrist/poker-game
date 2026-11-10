import type { Card } from '@cards/shared';
import { cardValue, handValue, legalFor } from './rules';
import type { Action, Legal, State } from './types';

type Move = 'hit' | 'stand' | 'double' | 'split';

/** Estratégia básica (banca para no 17, dobrar após dividir permitido). `up` = valor da carta aberta da banca (2..11). */
export function basicStrategy(cards: readonly Card[], up: number, can: { double: boolean; split: boolean }): Move {
  const { total, soft } = handValue(cards);
  const pair = cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
  if (pair && can.split) {
    const v = cardValue(cards[0]);
    if (v === 11 || v === 8) return 'split';
    if (v === 9 && ![7, 10, 11].includes(up)) return 'split';
    if (v === 7 && up <= 7) return 'split';
    if (v === 6 && up <= 6) return 'split';
    if (v === 4 && (up === 5 || up === 6)) return 'split';
    if ((v === 3 || v === 2) && up <= 7) return 'split';
  }
  const dbl = (cond: boolean, fallback: Move): Move => (cond && can.double ? 'double' : fallback);
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) {
      if (up >= 3 && up <= 6) return dbl(true, 'stand');
      return up === 2 || up === 7 || up === 8 ? 'stand' : 'hit';
    }
    if (total === 17) return dbl(up >= 3 && up <= 6, 'hit');
    if (total >= 15) return dbl(up >= 4 && up <= 6, 'hit');
    return dbl(up === 5 || up === 6, 'hit');
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return dbl(up <= 10, 'hit');
  if (total === 10) return dbl(up <= 9, 'hit');
  if (total === 9) return dbl(up >= 3 && up <= 6, 'hit');
  return 'hit';
}

export function safeAction(legal: Legal | null): Action {
  if (!legal) return { type: 'stand' };
  if (legal.phase === 'betting') return { type: 'skip' };
  if (legal.phase === 'insurance') return { type: 'insurance', take: false };
  return { type: 'stand' };
}

export function botAction(s: State, seat: number, rng: () => number): Action {
  const legal = legalFor(s, seat);
  if (!legal) return safeAction(legal);
  if (legal.phase === 'betting') {
    const k = 1 + Math.floor(rng() * 3);
    const amount = Math.max(legal.minBet, Math.min(legal.minBet * k, legal.maxBet));
    return amount <= legal.maxBet ? { type: 'bet', amount } : { type: 'skip' };
  }
  if (legal.phase === 'insurance') return { type: 'insurance', take: false };
  const e = s.entries.find((x) => x.seat === seat && !x.left);
  const h = e?.hands[legal.hand];
  if (!h) return { type: 'stand' };
  const move = basicStrategy(h.cards, cardValue(s.dealer[0]), { double: legal.double, split: legal.split });
  if (move === 'hit' && !legal.hit) return { type: 'stand' };
  return { type: move };
}
