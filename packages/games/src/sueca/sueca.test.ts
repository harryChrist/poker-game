import { describe, expect, it } from 'vitest';
import { createRng, isEngineError, isHidden, makeCard, type Card, type EngineCtx, type Rank, type Suit } from '@cards/shared';
import { bots, simulateMatch } from '../testing';
import { engine, scoreHand, type State, type View } from './index';

const c = (code: string): Card => makeCard(code.slice(0, -1) as Rank, code.slice(-1) as Suit);
const cs = (codes: string) => codes.split(' ').filter(Boolean).map(c);
const ctx = (seed = 1): EngineCtx => ({ rng: createRng(seed), now: 0 });

function mkState(over: Partial<State> = {}): State {
  return {
    players: bots(4), targetGames: 4, turnMs: 20000, dealer: 3,
    hands: [cs('AS 7S'), cs('KS 2H'), cs('3S 4S'), cs('AH 6D')],
    trump: c('6D'), phase: 'playing', turn: 0, trick: [], trickWinner: null, tricksDone: 0,
    points: [0, 0], games: [0, 0], handNo: 1, lastTrick: null, handResult: null, winnerTeam: null,
    ...over,
  };
}

describe('sueca', () => {
  it('é obrigatório seguir o naipe e a vaza vai para o maior trunfo/naipe', () => {
    const s = mkState({ turn: 1, trick: [{ seat: 0, card: c('AS') }], hands: [cs('7S'), cs('KS 2H'), cs('3S'), cs('AH')] });
    expect(isEngineError(engine.applyAction(s, 1, { type: 'play', cardId: '2H' }, ctx()))).toBe(true);
    expect((engine.getView(s, 1) as View).legal).toEqual(['KS']);
    expect(isEngineError(engine.applyAction(s, 1, { type: 'play', cardId: 'KS' }, ctx()))).toBe(false);

    // vaza completa: A + 7 + K + J de espadas = 28 para a dupla 0
    let t = mkState({ turn: 0, hands: [cs('AS 2C'), cs('7S 2H'), cs('KS 3C'), cs('JS 4C')], trump: c('4C') });
    let adv: number | undefined;
    for (const [seat, id] of [[0, 'AS'], [1, '7S'], [2, 'KS'], [3, 'JS']] as const) {
      const r = engine.applyAction(t, seat, { type: 'play', cardId: id }, ctx());
      if (isEngineError(r)) throw new Error(r.error);
      t = r.state; adv = r.advanceInMs;
    }
    expect(adv).toBeGreaterThan(1000);
    expect(engine.getTurn(t).seats).toEqual([]);
    expect(t.points).toEqual([28, 0]);
    expect(engine.advance(t, ctx()).state.turn).toBe(0);
  });

  it('pontuação da mão 61/91/120/60x60 e fim da partida', () => {
    expect(scoreHand([61, 59])).toMatchObject({ team: 0, games: 1 });
    expect(scoreHand([29, 91])).toMatchObject({ team: 1, games: 2 });
    expect(scoreHand([120, 0])).toMatchObject({ team: 0, games: 4 });
    expect(scoreHand([60, 60])).toMatchObject({ team: null, games: 0 });
    const end = mkState({
      phase: 'trickEnd', trickWinner: 0, tricksDone: 10, points: [100, 20], games: [2, 0],
      trick: [{ seat: 0, card: c('AS') }, { seat: 1, card: c('2S') }, { seat: 2, card: c('3S') }, { seat: 3, card: c('4S') }],
      hands: [[], [], [], []],
    });
    const out = engine.advance(end, ctx());
    expect(out.state.games).toEqual([4, 0]);
    expect(engine.getResult(out.state)?.winners).toEqual([0, 2]);
  });

  it('a visão não vaza cartas alheias', () => {
    const s = engine.create({ targetGames: 4, turnSeconds: 20 }, bots(4), ctx(11)).state;
    for (let seat = 0; seat < 4; seat++) {
      const v = engine.getView(s, seat) as View;
      v.hands.forEach((h, i) => { if (i !== seat) expect(h.every((x) => isHidden(x))).toBe(true); });
      const json = JSON.stringify({ ...v, hand: undefined, hands: undefined, trump: undefined });
      for (let o = 0; o < 4; o++) {
        if (o === seat) continue;
        for (const card of s.hands[o]) expect(json.includes(`"${card.id}"`)).toBe(false);
      }
    }
  });

  for (let seed = 1; seed <= 5; seed++) {
    it(`simula partida completa (seed ${seed})`, () => {
      const { result, state } = simulateMatch(engine, { targetGames: [1, 2, 4, 6, 4][seed - 1], turnSeconds: 20 }, 4, { seed, checkViews: true });
      expect(result.winners.length).toBe(2);
      expect(Math.max(...state.games)).toBeGreaterThanOrEqual([1, 2, 4, 6, 4][seed - 1]);
    });
  }
});
