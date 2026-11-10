import { describe, expect, it } from 'vitest';
import { createRng, isEngineError, isHidden, makeCard, type Card, type EngineCtx, type Rank, type Suit } from '@cards/shared';
import { bots, simulateMatch } from '../testing';
import { engine, legalCards, type State, type View } from './index';

const c = (code: string): Card => makeCard(code.slice(0, -1) as Rank, code.slice(-1) as Suit);
const cs = (codes: string) => codes.split(' ').filter(Boolean).map(c);
const ctx = (seed = 1): EngineCtx => ({ rng: createRng(seed), now: 0 });

function mkState(over: Partial<State> = {}): State {
  return {
    players: bots(4), endScore: 100, turnMs: 20000, handNo: 3,
    hands: [cs('2C 3C QS 5H'), cs('4C KS 2H'), cs('5C 2D'), cs('6C 3D')],
    phase: 'playing', passes: [null, null, null, null], received: [[], [], [], []], turn: 0, trick: [],
    trickWinner: null, tricksDone: 0, heartsBroken: false, handPoints: [0, 0, 0, 0], scores: [0, 0, 0, 0],
    queenBy: null, lastTrick: null, handResult: null, winners: null,
    ...over,
  };
}

describe('copas', () => {
  it('2♣ abre, 1ª vaza sem pontos e copas só depois de quebradas', () => {
    const s = mkState();
    expect(legalCards(s.hands[0], [], 0, false).map((x) => x.id)).toEqual(['2C']);
    // sem paus na 1ª vaza: não pode copas nem dama de espadas (tem outras opções)
    const hand = cs('QS 5H 7D 8D');
    expect(legalCards(hand, [{ seat: 0, card: c('2C') }], 0, false).map((x) => x.id)).toEqual(['7D', '8D']);
    // só tem pontos: libera
    expect(legalCards(cs('QS 5H'), [{ seat: 0, card: c('2C') }], 0, false).length).toBe(2);
    // não pode sair de copas antes de quebrar (se tem outro naipe), pode depois
    expect(legalCards(cs('5H 7D'), [], 1, false).map((x) => x.id)).toEqual(['7D']);
    expect(legalCards(cs('5H 7D'), [], 1, true).length).toBe(2);
    expect(legalCards(cs('5H 6H'), [], 1, false).length).toBe(2);
    // seguir naipe é obrigatório e a jogada ilegal é recusada
    const t = mkState({ turn: 1, tricksDone: 1, trick: [{ seat: 0, card: c('3C') }] });
    expect(isEngineError(engine.applyAction(t, 1, { type: 'play', cardId: 'KS' }, ctx()))).toBe(true);
    expect(isEngineError(engine.applyAction(t, 1, { type: 'play', cardId: '4C' }, ctx()))).toBe(false);
  });

  it('fechar o jogo dá 26 aos outros; passe só revela quando todos escolhem', () => {
    const last = mkState({
      phase: 'trickEnd', trickWinner: 2, tricksDone: 13, handPoints: [0, 0, 26, 0], scores: [10, 10, 10, 10],
      trick: [{ seat: 0, card: c('2S') }, { seat: 1, card: c('3S') }, { seat: 2, card: c('AS') }, { seat: 3, card: c('4S') }],
      hands: [[], [], [], []],
    });
    const out = engine.advance(last, ctx());
    expect(out.state.scores).toEqual([36, 36, 10, 36]);
    expect(out.state.handResult?.shooter).toBe(2);

    const end = engine.advance({ ...last, scores: [80, 80, 90, 80] }, ctx()).state;
    expect(engine.getResult(end)?.winners).toEqual([2]); // 90 < 106
    expect(end.scores).toEqual([106, 106, 90, 106]);

    // passe
    let s = engine.create({ endScore: 100, turnSeconds: 20 }, bots(4), ctx(5)).state;
    expect(engine.getTurn(s).seats).toEqual([0, 1, 2, 3]);
    const before = s.hands.map((h) => h.map((x) => x.id));
    for (let seat = 0; seat < 4; seat++) {
      const r = engine.applyAction(s, seat, { type: 'pass', cardIds: before[seat].slice(0, 3) }, ctx());
      if (isEngineError(r)) throw new Error(r.error);
      s = r.state;
      if (seat < 3) {
        expect(s.phase).toBe('passing');
        expect(s.hands[seat].map((x) => x.id)).toEqual(before[seat]); // ainda não trocou
      }
    }
    expect(s.phase).toBe('playing');
    // esquerda: assento i recebe do assento i-1
    expect(s.received[1]).toEqual(before[0].slice(0, 3));
    expect(s.hands.every((h) => h.length === 13)).toBe(true);
    const holder = s.hands.findIndex((h) => h.some((x) => x.id === '2C'));
    expect(engine.getTurn(s).seats).toEqual([holder]);
  });

  it('a visão não vaza cartas alheias nem o passe dos outros', () => {
    let s = engine.create({ endScore: 100, turnSeconds: 20 }, bots(4), ctx(9)).state;
    const r = engine.applyAction(s, 1, { type: 'pass', cardIds: s.hands[1].slice(0, 3).map((x) => x.id) }, ctx());
    if (isEngineError(r)) throw new Error(r.error);
    s = r.state;
    for (let seat = 0; seat < 4; seat++) {
      const v = engine.getView(s, seat) as View;
      const json = JSON.stringify({ ...v, hand: undefined });
      for (let o = 0; o < 4; o++) {
        if (o === seat) continue;
        for (const card of s.hands[o]) expect(json.includes(`"${card.id}"`)).toBe(false);
      }
      expect(v.hand.length).toBe(13);
    }
    expect((engine.getView(s, 2) as View).myPass).toBeNull();
    expect((engine.getView(s, 1) as View).passed[1]).toBe(true);
    expect(isHidden({ hidden: true })).toBe(true);
  });

  for (let seed = 1; seed <= 5; seed++) {
    it(`simula partida completa (seed ${seed})`, () => {
      const { result, state } = simulateMatch(engine, { endScore: [50, 75, 100][seed % 3], turnSeconds: 20 }, 4, { seed, checkViews: true });
      expect(result.winners.length).toBeGreaterThan(0);
      expect(Math.max(...state.scores)).toBeGreaterThanOrEqual([50, 75, 100][seed % 3]);
    });
  }
});
