import { describe, expect, it } from 'vitest';
import { createRng, isEngineError, isHidden, makeCard, type Card, type EngineCtx, type Rank, type Suit } from '@cards/shared';
import { bots, simulateMatch } from '../testing';
import { engine, manilhaRankOf, nextCardCount, trickWinnerOf, type State, type View } from './index';

const c = (code: string): Card => makeCard(code.slice(0, -1) as Rank, code.slice(-1) as Suit);
const cs = (codes: string) => codes.split(' ').filter(Boolean).map(c);
const ctx = (seed = 1): EngineCtx => ({ rng: createRng(seed), now: 0 });

function mkState(over: Partial<State> = {}): State {
  return {
    players: bots(3), turnMs: 20000, lives: [3, 3, 3], round: 3, cardsPer: 2, dir: 1, dealer: 2,
    phase: 'betting', hands: [cs('4C 5C'), cs('6C 7C'), cs('QC JC')], vira: c('KS'),
    bets: [null, null, null], won: [0, 0, 0], betOrder: [0, 1, 2], turn: 0, leader: 0, trick: [],
    trickWinner: null, tricksDone: 0, lastTrick: null, roundResult: null, winners: null,
    ...over,
  };
}

describe('fodinha', () => {
  it('manilha, embuchar e ciclo de cartas', () => {
    expect(manilhaRankOf(c('KS'))).toBe('A');
    expect(manilhaRankOf(c('3S'))).toBe('4'); // dá a volta
    // vira K => manilha A: paus vence copas; 3 vence 2
    expect(trickWinnerOf([{ seat: 0, card: c('AH') }, { seat: 1, card: c('AC') }, { seat: 2, card: c('3D') }], 'A')).toBe(1);
    expect(trickWinnerOf([{ seat: 0, card: c('3H') }, { seat: 1, card: c('2C') }], 'A')).toBe(0);
    // iguais se anulam: 3 e 3 anulam, 2 vence
    expect(trickWinnerOf([{ seat: 0, card: c('3H') }, { seat: 1, card: c('3C') }, { seat: 2, card: c('2D') }], 'A')).toBe(2);
    // todas anuladas
    expect(trickWinnerOf([{ seat: 0, card: c('5H') }, { seat: 1, card: c('5C') }], 'A')).toBeNull();
    // ciclo 1..máx..1..
    let cur = { n: 1, dir: 1 as 1 | -1 };
    const seq = [1];
    for (let i = 0; i < 12; i++) { cur = nextCardCount(cur.n, cur.dir, 4); seq.push(cur.n); }
    expect(seq).toEqual([1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1]);
  });

  it('restrição do pé: soma dos palpites não pode igualar o nº de cartas', () => {
    let s = mkState();
    for (const [seat, n] of [[0, 1], [1, 0]] as const) {
      const r = engine.applyAction(s, seat, { type: 'bet', n }, ctx());
      if (isEngineError(r)) throw new Error(r.error);
      s = r.state;
    }
    const v = engine.getView(s, 2) as View;
    expect(v.bet?.forbidden).toBe(1);
    expect(v.bet?.options).toEqual([0, 2]);
    expect(isEngineError(engine.applyAction(s, 2, { type: 'bet', n: 1 }, ctx()))).toBe(true);
    expect(engine.timeoutAction(s, 2)).toEqual({ type: 'bet', n: 0 });
    expect(isEngineError(engine.applyAction(s, 2, engine.botAction(s, 2, ctx()), ctx()))).toBe(false);
    const ok = engine.applyAction(s, 2, { type: 'bet', n: 2 }, ctx());
    expect(isEngineError(ok) ? '' : (ok.state.phase)).toBe('playing');
  });

  it('rodada de 1 carta esconde a própria; perda de vidas e vencedor', () => {
    const one = mkState({ cardsPer: 1, hands: [cs('4C'), cs('AH'), cs('3D')] });
    const v0 = engine.getView(one, 0) as View;
    expect(v0.oneCard).toBe(true);
    expect(isHidden(v0.hands[0][0])).toBe(true);
    expect(isHidden(v0.hands[1][0])).toBe(false);
    expect(JSON.stringify(v0.myHand)).not.toContain('4C');
    expect((engine.getView(one, null) as View).hands.flat().every((x) => isHidden(x))).toBe(true);

    // fim da rodada: |palpite - feitas| vidas; elimina e declara o último vivo
    const end = mkState({
      cardsPer: 1, phase: 'trickEnd', tricksDone: 1, hands: [[], [], []], lives: [1, 3, 2],
      bets: [1, 0, 1], won: [0, 1, 1], trickWinner: 2,
      trick: [{ seat: 0, card: c('4C') }, { seat: 1, card: c('5H') }, { seat: 2, card: c('3D') }],
    });
    const out = engine.advance(end, ctx());
    expect(out.state.lives).toEqual([0, 2, 2]);
    expect(out.state.phase).toBe('roundEnd');
    expect(out.advanceInMs).toBeGreaterThan(2000);
    const fin = engine.advance({ ...end, lives: [1, 1, 2], bets: [1, 0, 3 - 2], won: [0, 1, 1] }, ctx());
    expect(fin.state.lives).toEqual([0, 0, 2]);
    expect(engine.getResult(fin.state)?.winners).toEqual([2]);
    // todos zeram juntos: vencem os que tinham mais vidas antes
    const tie = engine.advance({ ...end, lives: [1, 1, 1], bets: [1, 1, 1], won: [0, 0, 0] }, ctx());
    expect(engine.getResult(tie.state)?.winners.sort()).toEqual([0, 1, 2]);
    const tie2 = engine.advance({ ...end, lives: [1, 2, 1], bets: [1, 3, 1], won: [0, 0, 0] }, ctx());
    expect(engine.getResult(tie2.state)?.winners).toEqual([1]);
  });

  for (const players of [2, 4, 8, 3, 6]) {
    it(`simula partida completa com ${players} jogadores`, () => {
      const { result } = simulateMatch(engine, { lives: 3, turnSeconds: 20 }, players, { seed: players * 7, checkViews: true });
      expect(result.winners.length).toBeGreaterThan(0);
    });
  }
});
