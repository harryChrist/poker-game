import { describe, it, expect } from 'vitest';
import { isEngineError, makeCard, createRng, type Rank, type Suit, type MatchEngine } from '@cards/shared';
import { simulateMatch, bots } from '../testing';
import { engine as cacheta } from '../cacheta';
import { engine as pife } from '../pife';
import type { RummyState, RummyAction } from './types';

const c = (r: Rank, s: Suit) => makeCard(r, s);
const ctx = () => ({ rng: createRng(7), now: 0 });

function setup(eng: MatchEngine<RummyState, RummyAction>, config: Record<string, number>, hand: ReturnType<typeof c>[]) {
  const r = eng.create(config, bots(2), ctx());
  const s = structuredClone(r.state);
  s.turn = 0; s.step = 'discard'; s.hands[0] = hand;
  return s;
}

const cachetaWin = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('7', 'H'), c('J', 'H'), c('Q', 'H'), c('K', 'S')];
const winning = [c('3', 'S'), c('3', 'H'), c('3', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('9', 'H'), c('T', 'H'), c('J', 'H'), c('K', 'S')];

describe('bater', () => {
  it('pife: bater válido ganha a rodada', () => {
    const s = setup(pife, { turnSeconds: 25, targetWins: 2 }, winning);
    const out = pife.applyAction(s, 0, { type: 'knock', discardId: 'KS' }, ctx());
    expect(isEngineError(out)).toBe(false);
    if (isEngineError(out)) return;
    expect(out.state.scores[0]).toBe(1);
    expect(out.state.phase).toBe('roundEnd');
    expect(out.advanceInMs).toBeGreaterThan(0);
    expect(pife.getTurn(out.state).seats).toEqual([]);
  });
  it('bater inválido dá erro e não muda nada', () => {
    const s = setup(pife, { turnSeconds: 25, targetWins: 1 }, winning);
    const out = pife.applyAction(s, 0, { type: 'knock', discardId: 'JH' }, ctx());
    expect(isEngineError(out) && out.error).toBe('Ainda não dá para bater');
  });
  it('cacheta: bater tira 1 vida dos outros; coringa vale', () => {
    const s = setup(cacheta, { turnSeconds: 25, lives: 3 }, cachetaWin);
    s.wildRank = 'A';
    const out = cacheta.applyAction(s, 0, { type: 'knock', discardId: 'KS' }, ctx());
    expect(isEngineError(out)).toBe(false);
    if (isEngineError(out)) return;
    expect(out.state.scores).toEqual([3, 2]);
    // com coringa (2): 3S 3H + 2D completam a trinca
    const s2 = setup(cacheta, { turnSeconds: 25, lives: 3 }, [c('3', 'S'), c('3', 'H'), c('2', 'D'), c('4', 'C'), c('5', 'C'), c('6', 'C'), c('7', 'H'), c('J', 'H'), c('Q', 'H'), c('K', 'S')]);
    s2.wildRank = '2';
    const out2 = cacheta.applyAction(s2, 0, { type: 'knock', discardId: 'KS' }, ctx());
    expect(isEngineError(out2)).toBe(false);
  });
});

describe('partidas completas', () => {
  for (const [name, eng, cfg] of [
    ['cacheta', cacheta, { turnSeconds: 25, lives: 3 }],
    ['pife', pife, { turnSeconds: 25, targetWins: 1 }],
  ] as const) {
    for (const players of [2, 6]) {
      it(`${name} termina com ${players} jogadores (5 seeds)`, () => {
        for (let seed = 1; seed <= 5; seed++) {
          const { result } = simulateMatch(eng as MatchEngine<RummyState>, cfg as Record<string, number>, players, { seed, checkViews: seed === 1 });
          expect(result.winners.length).toBeGreaterThan(0);
        }
      }, 120_000);
    }
  }
  it('view não vaza mãos alheias durante a rodada', () => {
    const r = cacheta.create({ turnSeconds: 25, lives: 3 }, bots(3), ctx());
    const view = JSON.stringify(cacheta.getView(r.state, 0));
    for (const seat of [1, 2]) for (const card of r.state.hands[seat]) expect(view).not.toContain(`"id":"${card.id}"`);
    expect(JSON.stringify(cacheta.getView(r.state, null))).not.toContain(`"id":"${r.state.hands[0][0].id}"`);
  });
});
