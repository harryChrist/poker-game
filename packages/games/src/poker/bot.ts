import { deck52, type Card } from '@cards/shared';
import { RANK_VALUE, scoreCards } from './evaluator';
import { entryFor, legalFor } from './rules';
import type { Action, Legal, State } from './types';

/** Força pré-flop pela fórmula de Chen (AA = 20, 72o = -1) */
export function chenScore(a: Card, b: Card): number {
  const pts = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  const ra = RANK_VALUE[a.r];
  const rb = RANK_VALUE[b.r];
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  let score = pts(hi);
  if (ra === rb) return Math.ceil(Math.max(5, score * 2));
  if (a.s === b.s) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/** Equity Monte Carlo contra `opps` mãos aleatórias */
export function equity(hole: Card[], board: Card[], opps: number, sims: number, rng: () => number): number {
  const known = new Set([...hole, ...board].map((c) => c.id));
  const pool = deck52().filter((c) => !known.has(c.id));
  const needBoard = 5 - board.length;
  const need = needBoard + 2 * opps;
  let score = 0;
  for (let k = 0; k < sims; k++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const full = board.concat(pool.slice(0, needBoard));
    const mine = scoreCards(hole.concat(full));
    let best = -1;
    let ties = 0;
    for (let o = 0; o < opps; o++) {
      const at = needBoard + o * 2;
      const sc = scoreCards([pool[at], pool[at + 1], ...full]);
      if (sc > best) { best = sc; ties = 1; } else if (sc === best) ties++;
    }
    if (mine > best) score += 1;
    else if (mine === best) score += 1 / (ties + 1);
  }
  return score / sims;
}

function isValid(legal: Legal, a: Action): boolean {
  switch (a.type) {
    case 'fold': return true;
    case 'check': return legal.check;
    case 'call': return legal.call !== null;
    case 'raise': return !!legal.raise && Number.isInteger(a.to) && a.to >= legal.raise.min && a.to <= legal.raise.max;
    case 'allin': return legal.allin !== null;
  }
}

export function safeFallback(legal: Legal | null): Action {
  return legal && legal.check ? { type: 'check' } : { type: 'fold' };
}

export function botAction(s: State, seat: number, rng: () => number): Action {
  const legal = legalFor(s, seat);
  const me = entryFor(s, seat);
  const st = s.seats[seat];
  if (!legal || !me || !st) return { type: 'fold' };
  const a = decide(s, seat, legal, rng);
  return isValid(legal, a) ? a : safeFallback(legal);
}

function decide(s: State, seat: number, legal: Legal, rng: () => number): Action {
  const me = entryFor(s, seat)!;
  const stack = s.seats[seat]!.stack;
  const bb = s.cfg.bb;
  const opps = s.hand.filter((p) => !p.folded && p.seat !== seat).length;
  const toCall = legal.toCall;
  const pot = legal.pot;
  const check: Action = legal.check ? { type: 'check' } : { type: 'fold' };
  const callOrCheck: Action = legal.check ? { type: 'check' } : legal.call !== null ? { type: 'call' } : { type: 'fold' };
  const raiseTo = (to: number): Action => {
    if (!legal.raise) return callOrCheck;
    const t = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(to)));
    // aposta quase tudo: vai all-in
    if (t >= (me.bet + stack) * 0.75 && legal.allin !== null) return { type: 'allin' };
    return { type: 'raise', to: t };
  };
  const shove: Action = legal.allin !== null ? { type: 'allin' } : callOrCheck;

  if (s.board.length === 0) {
    // ---- pré-flop ----
    const chen = chenScore(me.cards[0], me.cards[1]);
    const strength = Math.max(0, Math.min(1, (chen + 1) / 21));
    const order = s.hand.slice().sort((a, b) => a.seat - b.seat);
    const n = order.length;
    const bi = Math.max(0, order.findIndex((p) => p.seat === s.button));
    const mi = order.findIndex((p) => p.seat === seat);
    const d = (mi - bi + n) % n;
    const pos = d === 0 ? 1 : (d - 1) / Math.max(1, n - 1);
    const adj = strength + (pos - 0.5) * 0.12 - Math.max(0, opps - 3) * 0.015;
    const bbs = (stack + me.bet) / bb;
    const raised = s.currentBet > bb;

    if (bbs <= 10) {
      // push/fold
      if (adj > 0.46 || (toCall === 0 && legal.check)) return adj > 0.46 ? shove : check;
      return rng() < 0.05 ? shove : check;
    }
    if (!raised) {
      const limpers = s.hand.filter((p) => !p.folded && p.bet === bb && p.seat !== s.bbSeat).length;
      if (adj > 0.5 || (adj > 0.38 && pos > 0.6 && rng() < 0.5)) {
        return raiseTo(bb * (2.5 + rng()) + limpers * bb);
      }
      if (legal.check) return rng() < 0.06 && pos > 0.5 ? raiseTo(bb * 3) : check;
      if (adj > 0.3 || rng() < 0.08) return callOrCheck;
      return { type: 'fold' };
    }
    const frac = toCall / Math.max(1, stack);
    if (adj > 0.82) return frac > 0.35 || rng() < 0.35 ? shove : raiseTo(s.currentBet * 3);
    if (adj > 0.62) return rng() < 0.4 ? raiseTo(s.currentBet * 3) : callOrCheck;
    if (adj > 0.45 && frac < 0.12) return callOrCheck;
    if (adj > 0.36 && frac < 0.05) return callOrCheck;
    if (rng() < 0.025) return raiseTo(s.currentBet * 3);
    return { type: 'fold' };
  }

  // ---- pós-flop ----
  const eq = equity(me.cards, s.board, Math.max(1, opps), 150, rng);
  const potOdds = toCall / (pot + toCall || 1);
  const r = rng();
  if (toCall === 0) {
    const strong = 0.66 + 0.03 * Math.max(0, opps - 1);
    if (eq > strong) return r < 0.85 ? raiseTo(pot * (0.5 + rng() * 0.5)) : check;
    if (eq > strong - 0.14) return r < 0.55 ? raiseTo(pot * (0.33 + rng() * 0.33)) : check;
    if (eq < 0.35 && opps <= 2 && r < 0.12) return raiseTo(pot * 0.5);
    return check;
  }
  const adjEq = eq - Math.min(0.15, potOdds * 0.3);
  const frac = toCall / Math.max(1, stack);
  if (adjEq > 0.8) return r < 0.6 ? raiseTo(s.currentBet + (pot + toCall) * (0.6 + rng() * 0.4)) : callOrCheck;
  if (frac > 0.5 && adjEq < 0.6) return { type: 'fold' };
  if (adjEq > potOdds + 0.05) return callOrCheck;
  if (adjEq > potOdds - 0.03 && r < 0.3) return callOrCheck;
  if (r < 0.03 && frac < 0.2) return raiseTo(s.currentBet + (pot + toCall) * 0.7);
  return { type: 'fold' };
}
