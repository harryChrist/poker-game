/** Naipes: S = espadas ♠, H = copas ♥, D = ouros ♦, C = paus ♣ */
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';

export interface Card {
  r: Rank;
  s: Suit;
  /** id único dentro do baralho (útil quando há 2 baralhos, ex.: cacheta/pife). Ex.: "AS", "AS#2" */
  id: string;
}

/** Carta virada para baixo (o cliente só sabe que existe) */
export interface HiddenCard {
  hidden: true;
  id?: string;
}

export type MaybeCard = Card | HiddenCard;

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME_PT: Record<Suit, string> = { S: 'espadas', H: 'copas', D: 'ouros', C: 'paus' };
export const RANK_LABEL: Record<Rank, string> = {
  A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', T: '10', J: 'J', Q: 'Q', K: 'K',
};

export function isHidden(c: MaybeCard): c is HiddenCard {
  return (c as HiddenCard).hidden === true;
}

export function makeCard(r: Rank, s: Suit, copy = 1): Card {
  return { r, s, id: copy > 1 ? `${r}${s}#${copy}` : `${r}${s}` };
}

/** Baralho francês completo, 52 cartas */
export function deck52(copy = 1): Card[] {
  const out: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(makeCard(r, s, copy));
  return out;
}

/** Baralho de 40 cartas (sem 8, 9 e 10) — truco, bisca, sueca, fodinha, cacheta */
export function deck40(copy = 1): Card[] {
  return deck52(copy).filter((c) => c.r !== '8' && c.r !== '9' && c.r !== 'T');
}

/** Fisher–Yates usando o rng fornecido (retorna uma cópia embaralhada) */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardLabel(c: Card): string {
  return `${RANK_LABEL[c.r]}${SUIT_SYMBOL[c.s]}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return a.id === b.id;
}

export function hide(c: Card): HiddenCard {
  return { hidden: true };
}
