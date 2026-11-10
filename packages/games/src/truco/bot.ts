import type { Card, EngineCtx, Rank } from '@cards/shared';
import type { Action, Team, TrucoState } from './types';
import { canRequest, cardPower, lowestCard, nextValue, partnerSeat, playPower, teamOf } from './rules';

/** Força individual de uma carta, 0..1 */
export function cardStrength(c: Card, manilha: Rank): number {
  const p = cardPower(c, manilha);
  if (p >= 100) return [0.82, 0.88, 0.94, 1][p - 100];
  return [0.02, 0.05, 0.08, 0.12, 0.2, 0.28, 0.38, 0.5, 0.68, 0.78][p];
}

/** Força da mão, 0..1 (cartas fortes pesam mais) */
export function handStrength(cards: Card[], manilha: Rank): number {
  if (cards.length === 0) return 0;
  const v = cards.map((c) => cardStrength(c, manilha)).sort((a, b) => b - a);
  if (v.length === 1) return v[0];
  if (v.length === 2) return v[0] * 0.6 + v[1] * 0.4;
  return v[0] * 0.5 + v[1] * 0.3 + v[2] * 0.2;
}

function trickBalance(s: TrucoState, team: Team): number {
  let w = 0;
  let l = 0;
  for (const t of s.tricks) {
    if (t.winnerTeam === team) w++;
    else if (t.winnerTeam !== null) l++;
  }
  return w - l;
}

/** Estimativa de força considerando vazas já feitas e o parceiro vencendo */
function situationStrength(s: TrucoState, seat: number): number {
  const team = teamOf(seat);
  let p = handStrength(s.hands[seat], s.manilha);
  const bal = trickBalance(s, team);
  if (bal > 0) p += 0.2;
  else if (bal < 0) p -= 0.15;
  if (s.table.length > 0 && s.n === 4) {
    const best = bestPlay(s);
    if (best && teamOf(best.seat) === team) p += 0.05;
  }
  return Math.max(0, Math.min(1, p));
}

function bestPlay(s: TrucoState) {
  let best: (typeof s.table)[number] | null = null;
  for (const p of s.table) {
    if (!best || playPower(p, s.manilha) > playPower(best, s.manilha)) best = p;
  }
  return best;
}

function decide11Action(s: TrucoState, seat: number): Action {
  let cards = s.hands[seat].slice();
  const partner = partnerSeat(seat, s.n);
  if (partner !== null) cards = cards.concat(s.hands[partner]);
  const sorted = cards.sort((a, b) => cardStrength(b, s.manilha) - cardStrength(a, s.manilha)).slice(0, 3);
  const p = handStrength(sorted, s.manilha);
  return p >= 0.45 ? { type: 'play11' } : { type: 'run11' };
}

function respondAction(s: TrucoState, seat: number, rng: () => number): Action {
  const pv = s.pendingValue ?? 3;
  const myTeam = teamOf(seat);
  const oppScore = s.scores[1 - myTeam];
  // Correr já perde a partida: aceitar não custa nada
  if (oppScore + s.value >= 12) return { type: 'accept' };
  const p = situationStrength(s, seat);
  const need = ({ 3: 0.4, 6: 0.52, 9: 0.62, 12: 0.72 } as Record<number, number>)[pv] + (rng() - 0.5) * 0.1;
  const canRaise = nextValue(pv) !== null;
  if (canRaise && ((p >= need + 0.28 && rng() < 0.6) || rng() < 0.03)) return { type: 'raise' };
  return p >= need ? { type: 'accept' } : { type: 'run' };
}

function playAction(s: TrucoState, seat: number, rng: () => number): Action {
  const hand = s.hands[seat];
  if (s.mode === 'ferro') return { type: 'play', index: Math.floor(rng() * hand.length) };
  const myTeam = teamOf(seat);
  const sorted = hand.slice().sort((a, b) => cardPower(a, s.manilha) - cardPower(b, s.manilha));
  const canHide = s.tricks.length >= 1;

  if (s.table.length === 0) {
    // Abrindo a vaza
    if (s.tricks.length === 0 && sorted.length >= 3) return { type: 'play', cardId: sorted[1].id };
    return { type: 'play', cardId: sorted[sorted.length - 1].id };
  }
  const best = bestPlay(s)!;
  const bestPow = playPower(best, s.manilha);
  const partnerWinning = s.n === 4 && teamOf(best.seat) === myTeam;
  if (partnerWinning) {
    const low = sorted[0];
    return canHide && rng() < 0.25 ? { type: 'play', cardId: low.id, hidden: true } : { type: 'play', cardId: low.id };
  }
  const winners = sorted.filter((c) => cardPower(c, s.manilha) > bestPow);
  if (winners.length > 0) return { type: 'play', cardId: winners[0].id };
  const low = sorted[0];
  return canHide && rng() < 0.3 ? { type: 'play', cardId: low.id, hidden: true } : { type: 'play', cardId: low.id };
}

export function botAction(s: TrucoState, seat: number, ctx: EngineCtx): Action {
  const rng = ctx.rng;
  if (s.phase === 'decide11') return decide11Action(s, seat);
  if (s.phase === 'respond') return respondAction(s, seat, rng);
  if (canRequest(s, seat)) {
    const next = nextValue(s.value)!;
    const p = situationStrength(s, seat);
    const thr = ({ 3: 0.62, 6: 0.72, 9: 0.8, 12: 0.86 } as Record<number, number>)[next];
    if (p >= thr && rng() < 0.55) return { type: 'truco' };
    if (next === 3 && p < 0.3 && rng() < 0.04) return { type: 'truco' };
  }
  return playAction(s, seat, rng);
}

export function timeoutAction(s: TrucoState, seat: number): Action {
  if (s.phase === 'respond') return { type: 'run' };
  if (s.phase === 'decide11') {
    return s.hands[seat].some((c) => c.r === s.manilha) ? { type: 'play11' } : { type: 'run11' };
  }
  const hand = s.hands[seat];
  if (hand.length === 0) return { type: 'play', index: 0 };
  return { type: 'play', cardId: lowestCard(hand, s.manilha).id };
}
