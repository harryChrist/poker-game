import type { Card, Rank, Suit } from '@cards/shared';
import type { Play, Team, TrucoState } from './types';

/** Força das cartas comuns: 4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3 */
export const TRUCO_ORDER: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];

/** Manilhas por naipe: ouros < espadas < copas < paus (zap) */
const SUIT_POWER: Record<Suit, number> = { D: 0, S: 1, H: 2, C: 3 };

export function nextRank(r: Rank): Rank {
  const i = TRUCO_ORDER.indexOf(r);
  return TRUCO_ORDER[(i + 1) % TRUCO_ORDER.length];
}

export function cardPower(c: Card, manilha: Rank): number {
  if (c.r === manilha) return 100 + SUIT_POWER[c.s];
  return TRUCO_ORDER.indexOf(c.r);
}

export function playPower(p: Play, manilha: Rank): number {
  return p.hidden ? -1 : cardPower(p.card, manilha);
}

export const teamOf = (seat: number): Team => (seat % 2) as Team;

/** Próximo adversário em ordem a partir de `seat` */
export function nextAdversary(seat: number, n: number): number {
  for (let k = 1; k <= n; k++) {
    const s = (seat + k) % n;
    if (teamOf(s) !== teamOf(seat)) return s;
  }
  return (seat + 1) % n;
}

export function partnerSeat(seat: number, n: number): number | null {
  return n === 4 ? (seat + 2) % 4 : null;
}

/**
 * Resolve uma vaza. Cartas iguais de parceiros não empatam (a vaza é do time);
 * empate só quando as melhores cartas são de times diferentes.
 */
export function resolveTrick(plays: Play[], manilha: Rank): { winnerSeat: number | null; winnerTeam: Team | null } {
  let best = -Infinity;
  for (const p of plays) best = Math.max(best, playPower(p, manilha));
  const top = plays.filter((p) => playPower(p, manilha) === best);
  const teams = new Set(top.map((p) => teamOf(p.seat)));
  if (teams.size > 1) return { winnerSeat: null, winnerTeam: null };
  return { winnerSeat: top[0].seat, winnerTeam: teamOf(top[0].seat) };
}

/** Decide a mão a partir do resultado das vazas (null = empate). */
export function decideHand(r: (Team | null)[]): { done: boolean; winnerTeam: Team | null } {
  if (r.length < 2) return { done: false, winnerTeam: null };
  if (r.length === 2) {
    if (r[0] !== null && (r[1] === null || r[1] === r[0])) return { done: true, winnerTeam: r[0] };
    if (r[0] === null && r[1] !== null) return { done: true, winnerTeam: r[1] };
    return { done: false, winnerTeam: null };
  }
  // 3 vazas
  if (r[0] === null && r[1] === null) return { done: true, winnerTeam: r[2] };
  if (r[2] !== null) return { done: true, winnerTeam: r[2] };
  return { done: true, winnerTeam: r[0] ?? r[1] };
}

export function nextValue(v: number): number | null {
  return ({ 1: 3, 3: 6, 6: 9, 9: 12 } as Record<number, number>)[v] ?? null;
}

export function valueLabel(v: number): string {
  return ({ 3: 'TRUCO', 6: 'SEIS', 9: 'NOVE', 12: 'DOZE' } as Record<number, string>)[v] ?? String(v);
}

/** Pode `seat` pedir truco/aumentar agora (na sua vez, antes de jogar a carta)? */
export function canRequest(s: TrucoState, seat: number): boolean {
  if (s.phase !== 'play' || s.turnSeat !== seat) return false;
  if (s.mode !== 'normal') return false;
  if (s.pendingValue !== null) return false;
  if (nextValue(s.value) === null) return false;
  return s.lastRequestTeam !== teamOf(seat);
}

export function lowestCard(hand: Card[], manilha: Rank): Card {
  return hand.reduce((a, b) => (cardPower(b, manilha) < cardPower(a, manilha) ? b : a));
}

export function teamName(s: TrucoState, team: Team): string {
  return s.n === 2 ? s.players[team].name : `Dupla ${team === 0 ? 'A' : 'B'}`;
}
