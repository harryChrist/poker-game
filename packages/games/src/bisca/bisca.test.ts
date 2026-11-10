import { describe, expect, it } from 'vitest';
import { deck40, makeCard, type Card, type Rank, type Suit } from '@cards/shared';
import { simulateMatch } from '../testing';
import { engine } from './engine';
import { cardPoints, trickWinner } from './rules';

const c = (r: Rank, s: Suit): Card => makeCard(r, s);
const P = (seat: number, card: Card) => ({ seat, card });

describe('bisca: regras', () => {
  it('vaza sem trunfo: maior do naipe de saída vence', () => {
    const w = trickWinner([P(0, c('K', 'S')), P(1, c('A', 'H')), P(2, c('7', 'S')), P(3, c('Q', 'S'))], 'D');
    expect(w.seat).toBe(2);
  });
  it('vaza com trunfo: maior trunfo vence', () => {
    const w = trickWinner([P(0, c('A', 'S')), P(1, c('2', 'D')), P(2, c('3', 'D')), P(3, c('7', 'S'))], 'D');
    expect(w.seat).toBe(2);
  });
  it('baralho soma 120 pontos', () => {
    expect(deck40().reduce((s, x) => s + cardPoints(x), 0)).toBe(120);
  });
});

describe('bisca: simulação com bots', () => {
  for (const players of [2, 4]) {
    it(`${players} jogadores: 5 sementes terminam`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const { result } = simulateMatch(engine, { turnSeconds: 20, targetWins: 2, players }, players, { seed, checkViews: true });
        expect(result.winners.length).toBe(players === 4 ? 2 : 1);
      }
    });
  }
});
