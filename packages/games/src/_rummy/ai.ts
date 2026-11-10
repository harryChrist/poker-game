/** Heurísticas de bot (e do timeoutAction) para Cacheta e Pife. */
import type { Card } from '@cards/shared';
import { analyze, isWildCard, potential, splitOf, type RummyRules } from './melds';

export interface KnockOptions {
  /** Índices (na mão de 10 cartas) que podem ser descartados para bater */
  discardIdx: number[];
  /** As 10 cartas já formam jogos */
  all: boolean;
}

/** Opções de bater com a mão de 10 cartas (depois de comprar). Mão de outro tamanho => nada. */
export function knockOptions(rules: RummyRules, hand: Card[]): KnockOptions {
  if (hand.length !== 10) return { discardIdx: [], all: false };
  const a = analyze(rules, hand);
  const discardIdx: number[] = [];
  for (let i = 0; i < a.n; i++) if (a.best[a.full & ~(1 << i)] === 9) discardIdx.push(i);
  return { discardIdx, all: a.best[a.full] === 10 };
}

/** Ordena as cartas candidatas a descarte ao bater: a recém-comprada primeiro, coringas por último */
export function orderKnockDiscards(rules: RummyRules, hand: Card[], idx: number[], drawnId: string | null): number[] {
  const key = (i: number) => (isWildCard(rules, hand[i]) ? 2 : hand[i].id === drawnId ? 0 : 1);
  return idx.slice().sort((x, y) => key(x) - key(y) || x - y);
}

/** Pontuação de uma mão de 9 cartas: cartas em jogos (peso grande) + potencial das soltas */
function handScore(rules: RummyRules, a: ReturnType<typeof analyze>, mask: number): number {
  const sp = splitOf(a, mask);
  return a.best[mask] * 100 + potential(rules, sp.loose.map((i) => a.cards[i]));
}

/**
 * Escolhe o índice da carta a descartar numa mão de 10 cartas: a que deixa as 9 restantes com mais cartas
 * em jogos e mais potencial. Coringas só saem se não houver jeito. `forbiddenId` não pode ser escolhida.
 */
export function chooseDiscard(rules: RummyRules, hand: Card[], forbiddenId: string | null): number {
  const a = analyze(rules, hand);
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < a.n; i++) {
    if (hand[i].id === forbiddenId) continue;
    const mask = a.full & ~(1 << i);
    let s = handScore(rules, a, mask);
    if (isWildCard(rules, hand[i])) s -= 500;
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return bestIdx >= 0 ? bestIdx : 0;
}

/** Vale a pena pegar o topo do descarte (em vez de comprar do monte)? */
export function shouldTakeDiscard(rules: RummyRules, hand9: Card[], top: Card): boolean {
  if (hand9.length !== 9) return false;
  const a9 = analyze(rules, hand9);
  const score0 = handScore(rules, a9, a9.full);
  const hand10 = [...hand9, top];
  const a10 = analyze(rules, hand10);
  let best = -Infinity;
  for (let i = 0; i < 9; i++) {
    const mask = a10.full & ~(1 << i);
    if (a10.best[mask] === 9) return true; // bateria com ela
    const s = handScore(rules, a10, mask) - (isWildCard(rules, hand10[i]) ? 500 : 0);
    if (s > best) best = s;
  }
  return best > score0;
}
