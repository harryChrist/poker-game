import { describe, it, expect } from 'vitest';
import { makeCard, type Rank, type Suit } from '@cards/shared';
import { CACHETA_ORDER, PIFE_ORDER, isSet, isRun, isValidGroup, canPartition, bestArrangement, type RummyRules } from './melds';

const c = (r: Rank, s: Suit, copy = 1) => makeCard(r, s, copy);
const cacheta: RummyRules = { order: CACHETA_ORDER, wildRank: 'K' };
const pife: RummyRules = { order: PIFE_ORDER, wildRank: null };

describe('jogos válidos', () => {
  it('trinca exige naipes diferentes (2 baralhos)', () => {
    expect(isSet(pife, [c('3', 'H'), c('3', 'S'), c('3', 'D')])).toBe(true);
    expect(isSet(pife, [c('3', 'H'), c('3', 'S'), c('3', 'D'), c('3', 'C')])).toBe(true);
    expect(isSet(pife, [c('3', 'H'), c('3', 'H', 2), c('3', 'D')])).toBe(false);
    expect(isSet(pife, [c('3', 'H'), c('4', 'S'), c('3', 'D')])).toBe(false);
    expect(isSet(pife, [c('3', 'H'), c('3', 'S')])).toBe(false);
  });
  it('sequência: Ás baixo/alto, sem volta, J após 7 na cacheta', () => {
    expect(isRun(pife, [c('A', 'H'), c('2', 'H'), c('3', 'H')])).toBe(true);
    expect(isRun(pife, [c('Q', 'H'), c('K', 'H'), c('A', 'H')])).toBe(true);
    expect(isRun(pife, [c('K', 'H'), c('A', 'H'), c('2', 'H')])).toBe(false);
    expect(isRun(pife, [c('3', 'H'), c('4', 'S'), c('5', 'H')])).toBe(false);
    expect(isRun(pife, [c('7', 'H'), c('J', 'H'), c('Q', 'H')])).toBe(false);
    expect(isRun(cacheta, [c('7', 'H'), c('J', 'H'), c('Q', 'H')])).toBe(true);
    expect(isRun(cacheta, [c('Q', 'D'), c('A', 'D'), c('K', 'D')])).toBe(true);
  });
  it('coringa substitui em trinca e sequência', () => {
    expect(isValidGroup(cacheta, [c('3', 'H'), c('3', 'S'), c('K', 'C')])).toBe(true);
    expect(isValidGroup(cacheta, [c('4', 'H'), c('6', 'H'), c('K', 'S', 2)])).toBe(true);
    expect(isValidGroup(cacheta, [c('4', 'H'), c('7', 'H'), c('K', 'S')])).toBe(false);
    expect(isValidGroup(pife, [c('4', 'H'), c('6', 'H'), c('K', 'S')])).toBe(false);
  });
});

describe('particionamento exato', () => {
  it('casos positivos', () => {
    expect(canPartition(pife, [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('9', 'H'), c('T', 'H'), c('J', 'H')])).toBe(true);
    // coringa K completa a trinca
    expect(canPartition(cacheta, [c('3', 'S'), c('3', 'H'), c('K', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('7', 'H'), c('J', 'H'), c('Q', 'H')])).toBe(true);
  });
  it('casos negativos', () => {
    expect(canPartition(pife, [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('4', 'C'), c('5', 'C'), c('7', 'C'), c('9', 'H'), c('T', 'H'), c('J', 'H')])).toBe(false);
    expect(canPartition(pife, [c('3', 'S'), c('3', 'H'), c('K', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('7', 'H'), c('J', 'H'), c('Q', 'H')])).toBe(false);
  });
  it('melhor divisão minimiza soltas', () => {
    const arr = bestArrangement(pife, [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('4', 'C'), c('9', 'H')]);
    expect(arr.groups.length).toBe(1);
    expect(arr.loose.length).toBe(2);
  });
});
