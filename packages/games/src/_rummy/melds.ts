/**
 * Regras de jogos (trincas e sequências) compartilhadas por Cacheta e Pife.
 *
 * - TRINCA: 3 ou 4 cartas do mesmo valor, com naipes todos diferentes.
 * - SEQUÊNCIA: 3+ cartas do mesmo naipe em ordem. O Ás vale baixo (antes do 2) ou alto (depois do K),
 *   mas a sequência nunca "dá a volta" (K-A-2 é inválida).
 * - CORINGA (só cacheta): carta de um valor específico (`wildRank`), de qualquer naipe, substitui qualquer carta.
 *
 * A análise de uma mão usa bitmasks: o conjunto de todos os jogos válidos possíveis e uma programação
 * dinâmica exata sobre os subconjuntos, que dá a melhor divisão (mais cartas em jogos) de qualquer subconjunto.
 */
import type { Card, Rank, Suit } from '@cards/shared';

export interface RummyRules {
  /** Ordem das cartas numa sequência, do Ás baixo ao K. O Ás também pode ser alto (depois da última). */
  order: Rank[];
  /** Valor das cartas coringa (cacheta); null = sem coringas (pife) */
  wildRank: Rank | null;
}

/** Cacheta: baralho de 40 cartas, o J vem logo depois do 7 */
export const CACHETA_ORDER: Rank[] = ['A', '2', '3', '4', '5', '6', '7', 'J', 'Q', 'K'];
/** Pife: baralho completo */
export const PIFE_ORDER: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

const SUIT_INDEX: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };

export function isWildCard(rules: RummyRules, c: Card): boolean {
  return rules.wildRank !== null && c.r === rules.wildRank;
}

/** Valor do coringa dada a vira (valor seguinte; depois do K volta ao A) */
export function wildRankFor(order: Rank[], viraRank: Rank): Rank {
  const i = order.indexOf(viraRank);
  return order[(i + 1) % order.length];
}

interface Info {
  wild: boolean;
  rank: number; // índice em order (Ás = 0)
  suit: number;
}

function infoOf(rules: RummyRules, c: Card): Info {
  return { wild: isWildCard(rules, c), rank: rules.order.indexOf(c.r), suit: SUIT_INDEX[c.s] };
}

function popcount(x: number): number {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}
function ctz(x: number): number {
  return 31 - Math.clz32(x & -x);
}

/** Cabe numa janela de `n` posições consecutivas (Ás baixo ou alto)? rankBits: bit i = valor de índice i presente */
function runFits(rankBits: number, n: number, L: number): boolean {
  if (rankBits === 0) return true;
  const span = (bits: number) => (31 - Math.clz32(bits)) - ctz(bits) + 1;
  if (span(rankBits) <= n) return true;
  if (rankBits & 1) {
    const high = (rankBits & ~1) | (1 << L);
    if (span(high) <= n) return true;
  }
  return false;
}

const KIND_SET = 1;
const KIND_RUN = 2;

/** 0 = inválido; bit 1 = trinca; bit 2 = sequência */
function classify(infos: Info[], mask: number, L: number): number {
  let n = 0, nat = 0, suitBits = 0, rankBits = 0, firstRank = -1, firstSuit = -1;
  let sameRank = true, sameSuit = true, dupSuit = false, dupRank = false;
  for (let i = 0; mask >> i; i++) {
    if (!((mask >> i) & 1)) continue;
    n++;
    const c = infos[i];
    if (c.wild) continue;
    nat++;
    if (firstRank < 0) { firstRank = c.rank; firstSuit = c.suit; }
    else {
      if (c.rank !== firstRank) sameRank = false;
      if (c.suit !== firstSuit) sameSuit = false;
    }
    const sb = 1 << c.suit;
    if (suitBits & sb) dupSuit = true;
    suitBits |= sb;
    const rb = 1 << c.rank;
    if (rankBits & rb) dupRank = true;
    rankBits |= rb;
  }
  if (n < 3) return 0;
  let kind = 0;
  if (n <= 4 && sameRank && !dupSuit) kind |= KIND_SET;
  if (n <= L && sameSuit && !dupRank && runFits(rankBits, n, L)) kind |= KIND_RUN;
  return kind;
}

/** Esse conjunto de cartas é um jogo válido (trinca ou sequência)? */
export function isValidGroup(rules: RummyRules, cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 14) return false;
  const infos = cards.map((c) => infoOf(rules, c));
  return classify(infos, (1 << cards.length) - 1, rules.order.length) !== 0;
}

export function isSet(rules: RummyRules, cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 14) return false;
  const infos = cards.map((c) => infoOf(rules, c));
  return (classify(infos, (1 << cards.length) - 1, rules.order.length) & KIND_SET) !== 0;
}

export function isRun(rules: RummyRules, cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 14) return false;
  const infos = cards.map((c) => infoOf(rules, c));
  return (classify(infos, (1 << cards.length) - 1, rules.order.length) & KIND_RUN) !== 0;
}

export interface HandAnalysis {
  rules: RummyRules;
  cards: Card[];
  n: number;
  full: number;
  /** máscaras de todos os jogos válidos */
  groupMasks: number[];
  /** best[mask] = máximo de cartas de `mask` que cabem em jogos disjuntos */
  best: Uint8Array;
  /** pick[mask] = jogo escolhido que contém a carta de menor índice de `mask` (0 = ela fica solta) */
  pick: Uint32Array;
}

const MAX_ANALYZE = 14;

/** Análise exata da mão (até 14 cartas; acima disso nada é considerado jogo) */
export function analyze(rules: RummyRules, cards: Card[]): HandAnalysis {
  const n = Math.min(cards.length, MAX_ANALYZE);
  const infos = cards.slice(0, n).map((c) => infoOf(rules, c));
  const L = rules.order.length;
  const full = (1 << n) - 1;
  const groupMasks: number[] = [];
  const byLow: number[][] = Array.from({ length: n }, () => []);
  for (let m = 7; m <= full; m++) {
    if (popcount(m) < 3) continue;
    if (classify(infos, m, L) !== 0) {
      groupMasks.push(m);
      byLow[ctz(m)].push(m);
    }
  }
  const best = new Uint8Array(full + 1);
  const pick = new Uint32Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const i = ctz(mask);
    let b = best[mask ^ (1 << i)];
    let p = 0;
    for (const g of byLow[i]) {
      if ((g & mask) === g) {
        const v = best[mask ^ g] + popcount(g);
        if (v > b) { b = v; p = g; }
      }
    }
    best[mask] = b;
    pick[mask] = p;
  }
  return { rules, cards: cards.slice(0, n), n, full, groupMasks, best, pick };
}

/** Máscara com todas as cartas, menos a de índice `i` */
export function without(a: HandAnalysis, i: number): number {
  return a.full & ~(1 << i);
}

/** Quantas cartas do subconjunto cabem em jogos */
export function covered(a: HandAnalysis, mask: number): number {
  return a.best[mask];
}

/** O subconjunto inteiro se divide em jogos válidos? */
export function canPartitionMask(a: HandAnalysis, mask: number): boolean {
  return popcount(mask) >= 3 && a.best[mask] === popcount(mask);
}

/** Atalho: este conjunto de cartas pode ser TOTALMENTE dividido em jogos válidos? (coringas incluídos) */
export function canPartition(rules: RummyRules, cards: Card[]): boolean {
  if (cards.length === 0) return false;
  if (cards.length < 3 || cards.length > MAX_ANALYZE) return false;
  const a = analyze(rules, cards);
  return a.best[a.full] === a.n;
}

export interface Split {
  /** índices (na lista original) de cada jogo */
  groups: number[][];
  /** índices das cartas soltas */
  loose: number[];
}

/** Reconstrói a melhor divisão de um subconjunto, por índices */
export function splitOf(a: HandAnalysis, mask: number): Split {
  const groups: number[][] = [];
  const loose: number[] = [];
  let m = mask;
  while (m) {
    const i = ctz(m);
    const p = a.pick[m];
    if (p === 0) {
      loose.push(i);
      m ^= 1 << i;
    } else {
      const g: number[] = [];
      for (let j = 0; j < a.n; j++) if ((p >> j) & 1) g.push(j);
      groups.push(g);
      m ^= p;
    }
  }
  return { groups, loose };
}

/** Ordena as cartas de um jogo para exibição (sequência em ordem, coringas preenchendo os buracos/pontas) */
export function orderGroup(rules: RummyRules, cards: Card[]): Card[] {
  const infos = cards.map((c) => infoOf(rules, c));
  const L = rules.order.length;
  const n = cards.length;
  const kind = classify(infos, (1 << n) - 1, L);
  const naturals = cards.filter((_, i) => !infos[i].wild);
  const wilds = cards.filter((_, i) => infos[i].wild);
  const isSetOnly = (kind & KIND_SET) !== 0 && (kind & KIND_RUN) === 0;
  if (isSetOnly || (kind & KIND_RUN) === 0) {
    return [...naturals.sort((x, y) => SUIT_INDEX[x.s] - SUIT_INDEX[y.s]), ...wilds];
  }
  // sequência: acha as posições dos naturais (Ás baixo ou alto)
  const rankOf = (c: Card) => rules.order.indexOf(c.r);
  let bitsLow = 0;
  for (const c of naturals) bitsLow |= 1 << rankOf(c);
  const span = (bits: number) => (31 - Math.clz32(bits)) - ctz(bits) + 1;
  let positions: { c: Card; p: number }[];
  const lowOk = bitsLow === 0 || span(bitsLow) <= n;
  if (lowOk) positions = naturals.map((c) => ({ c, p: rankOf(c) }));
  else positions = naturals.map((c) => ({ c, p: rankOf(c) === 0 ? L : rankOf(c) }));
  if (positions.length === 0) return cards.slice();
  const lo = Math.min(...positions.map((x) => x.p));
  const s = Math.min(lo, L - n + 1);
  const slots: (Card | null)[] = Array.from({ length: n }, () => null);
  for (const { c, p } of positions) slots[p - s] = c;
  const w = wilds.slice();
  return slots.map((x) => x ?? w.pop()!);
}

export interface Arrangement {
  groups: Card[][];
  loose: Card[];
}

/** Melhor divisão de uma lista de cartas, com os jogos ordenados e as soltas por naipe/valor */
export function bestArrangement(rules: RummyRules, cards: Card[]): Arrangement {
  if (cards.length === 0) return { groups: [], loose: [] };
  const a = analyze(rules, cards);
  const sp = splitOf(a, a.full);
  const groups = sp.groups.map((g) => orderGroup(rules, g.map((i) => cards[i])));
  groups.sort((x, y) => sortKey(rules, x[0]) - sortKey(rules, y[0]));
  const loose = sp.loose.map((i) => cards[i]).concat(cards.slice(a.n));
  loose.sort((x, y) => sortKey(rules, x) - sortKey(rules, y));
  return { groups, loose };
}

/** Chave de ordenação por naipe e depois valor (coringas por último) */
export function sortKey(rules: RummyRules, c: Card): number {
  if (isWildCard(rules, c)) return 1000 + SUIT_INDEX[c.s];
  return SUIT_INDEX[c.s] * 20 + rules.order.indexOf(c.r);
}

/** Mão ordenada por naipe e valor (coringas no fim) */
export function sortHand(rules: RummyRules, cards: Card[]): Card[] {
  return cards.slice().sort((x, y) => sortKey(rules, x) - sortKey(rules, y));
}

/**
 * Potencial das cartas soltas: pares que ainda podem virar jogo com mais uma carta.
 * Usado só como desempate pela IA.
 */
export function potential(rules: RummyRules, loose: Card[]): number {
  const L = rules.order.length;
  let score = 0;
  for (let i = 0; i < loose.length; i++) {
    const a = loose[i];
    if (isWildCard(rules, a)) { score += 3; continue; }
    for (let j = i + 1; j < loose.length; j++) {
      const b = loose[j];
      if (isWildCard(rules, b)) continue;
      const ra = rules.order.indexOf(a.r), rb = rules.order.indexOf(b.r);
      if (ra === rb) {
        if (a.s !== b.s) score += 2;
      } else if (a.s === b.s) {
        let d = Math.abs(ra - rb);
        if (ra === 0 || rb === 0) {
          const k = Math.max(ra, rb);
          d = Math.min(k, L - k); // Ás baixo ou alto
        }
        if (d === 1) score += 2;
        else if (d === 2) score += 1;
      }
    }
  }
  return score;
}

/** Regras de cada jogo (a vira define o coringa na cacheta) */
export function rulesFor(game: 'cacheta' | 'pife', wildRank: Rank | null): RummyRules {
  return game === 'cacheta'
    ? { order: CACHETA_ORDER, wildRank }
    : { order: PIFE_ORDER, wildRank: null };
}
