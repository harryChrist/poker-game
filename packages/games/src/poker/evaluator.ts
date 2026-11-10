import type { Card, Suit } from '@cards/shared';

/** Avaliador de mãos de poker (5 a 7 cartas). Score maior = mão melhor; scores iguais = empate. */

export const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
} as const;

const SUIT_INDEX: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };

function pack(cat: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return (cat << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;
}

/** máscara de ranks (bit 1 = Ás baixo, bits 2..14). Devolve a carta mais alta da melhor sequência ou 0 */
function straightHigh(mask: number): number {
  const m = mask & (mask >> 1) & (mask >> 2) & (mask >> 3) & (mask >> 4);
  if (!m) return 0;
  return 31 - Math.clz32(m) + 4;
}

const cnt = new Int8Array(15);
const suitMask = [0, 0, 0, 0];
const suitCnt = [0, 0, 0, 0];

/** Score numérico da melhor mão de 5 cartas dentre as cartas dadas (5 a 7). Rápido (sem alocações grandes). */
export function scoreCards(cards: readonly Card[]): number {
  cnt.fill(0);
  suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
  suitCnt[0] = suitCnt[1] = suitCnt[2] = suitCnt[3] = 0;
  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = RANK_VALUE[c.r];
    const si = SUIT_INDEX[c.s];
    cnt[r]++;
    suitMask[si] |= 1 << r;
    suitCnt[si]++;
    rankMask |= 1 << r;
  }
  let flushSuit = -1;
  for (let si = 0; si < 4; si++) if (suitCnt[si] >= 5) flushSuit = si;

  if (flushSuit >= 0) {
    let m = suitMask[flushSuit];
    if (m & (1 << 14)) m |= 2;
    const sh = straightHigh(m);
    if (sh) return pack(CAT.STRAIGHT_FLUSH, sh);
  }

  let quads = 0;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const c = cnt[r];
    if (c === 4) { if (!quads) quads = r; else pairs.push(r); } else if (c === 3) trips.push(r);
    else if (c === 2) pairs.push(r);
  }
  if (quads) {
    let k = 0;
    for (let r = 14; r >= 2; r--) if (r !== quads && cnt[r] > 0) { k = r; break; }
    return pack(CAT.QUADS, quads, k);
  }
  if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return pack(CAT.FULL_HOUSE, trips[0], p);
  }
  if (flushSuit >= 0) {
    const m = suitMask[flushSuit];
    const top: number[] = [];
    for (let r = 14; r >= 2 && top.length < 5; r--) if (m & (1 << r)) top.push(r);
    return pack(CAT.FLUSH, top[0], top[1], top[2], top[3], top[4]);
  }
  let rm = rankMask;
  if (rm & (1 << 14)) rm |= 2;
  const sh = straightHigh(rm);
  if (sh) return pack(CAT.STRAIGHT, sh);

  const kickers = (exclude: number[], n: number): number[] => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < n; r--) if (cnt[r] > 0 && !exclude.includes(r)) out.push(r);
    return out;
  };
  if (trips.length) {
    const k = kickers([trips[0]], 2);
    return pack(CAT.TRIPS, trips[0], k[0], k[1]);
  }
  if (pairs.length >= 2) {
    const k = kickers([pairs[0], pairs[1]], 1);
    return pack(CAT.TWO_PAIR, pairs[0], pairs[1], k[0]);
  }
  if (pairs.length === 1) {
    const k = kickers([pairs[0]], 3);
    return pack(CAT.PAIR, pairs[0], k[0], k[1], k[2]);
  }
  const k = kickers([], 5);
  return pack(CAT.HIGH, k[0], k[1], k[2], k[3], k[4]);
}

export function categoryOf(score: number): number {
  return score >> 20;
}

const RANK_PLURAL: Record<number, string> = {
  14: 'Ases', 13: 'Reis', 12: 'Damas', 11: 'Valetes', 10: 'Dez', 9: 'Noves', 8: 'Oitos', 7: 'Setes', 6: 'Seis', 5: 'Cincos', 4: 'Quatros', 3: 'Treses', 2: 'Dois',
};

/** Nome da mão em português a partir do score */
export function handNameOf(score: number): string {
  const cat = score >> 20;
  const r1 = (score >> 16) & 15;
  switch (cat) {
    case CAT.STRAIGHT_FLUSH: return r1 === 14 ? 'Royal Flush' : 'Straight Flush';
    case CAT.QUADS: return 'Quadra';
    case CAT.FULL_HOUSE: return 'Full House';
    case CAT.FLUSH: return 'Flush';
    case CAT.STRAIGHT: return 'Sequência';
    case CAT.TRIPS: return `Trinca de ${RANK_PLURAL[r1]}`;
    case CAT.TWO_PAIR: return 'Dois Pares';
    case CAT.PAIR: return `Par de ${RANK_PLURAL[r1]}`;
    default: return 'Carta Alta';
  }
}

export interface HandEval {
  score: number;
  category: number;
  name: string;
  /** as 5 cartas que formam a melhor mão */
  best: Card[];
}

/** Melhor mão de 5 cartas dentre 5-7 cartas (com as cartas usadas, para destaque na tela). */
export function evaluate(cards: readonly Card[]): HandEval {
  const score = scoreCards(cards);
  let best: Card[] = cards.slice(0, 5);
  if (cards.length > 5) {
    const pick: Card[] = [];
    const search = (start: number): boolean => {
      if (pick.length === 5) return scoreCards(pick) === score;
      for (let i = start; i < cards.length; i++) {
        pick.push(cards[i]);
        if (search(i + 1)) return true;
        pick.pop();
      }
      return false;
    };
    if (search(0)) best = pick.slice();
  }
  return { score, category: categoryOf(score), name: handNameOf(score), best };
}
