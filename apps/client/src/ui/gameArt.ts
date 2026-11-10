import type { GameId } from '@cards/shared';

/** Ícone e cor de cada jogo (cartões do lobby, lista de salas) */
export const GAME_ART: Record<GameId, { icon: string; color: string; tagline: string }> = {
  poker: { icon: '♠', color: '#1f7a52', tagline: "Texas Hold'em sem limite" },
  blackjack: { icon: '21', color: '#b07d12', tagline: 'Contra a banca' },
  truco: { icon: '♣', color: '#a83232', tagline: 'Paulista, até 12 pontos' },
  bisca: { icon: '♦', color: '#7d3cc4', tagline: 'Trunfo, 3 cartas' },
  sueca: { icon: '♥', color: '#2f6fd1', tagline: 'Duplas e trunfo' },
  copas: { icon: '♡', color: '#c0392b', tagline: 'Fuja das copas' },
  fodinha: { icon: '?', color: '#178a8a', tagline: 'Aposte suas vazas' },
  cacheta: { icon: '★', color: '#c26a0a', tagline: 'Com coringa da vira' },
  pife: { icon: '9', color: '#55606e', tagline: 'Três jogos e bata' },
};

export function playersLabel(counts: number[]): string {
  const a = counts[0];
  const b = counts[counts.length - 1];
  return a === b ? `${a} jogadores` : counts.length === 2 && b - a > 1 ? `${a} ou ${b} jogadores` : `${a}–${b} jogadores`;
}
