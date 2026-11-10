import { describe, expect, it } from 'vitest';
import { makeCard, resolveConfig, isEngineError, type Card, type Rank, type Suit } from '@cards/shared';
import { simulateSession } from '../testing';
import { engine } from './index';
import { handValue } from './rules';
import type { Action, State, View } from './types';

const ctx = { rng: () => 0.5, now: 0 };
const c = (s: string): Card => makeCard(s[0] as Rank, s[1].toUpperCase() as Suit);

/** Mesa com 1 jogador (1000 fichas) e sapato forçado (cartas na ordem em que serão sacadas) */
function setup(draws: string[]) {
  let st = engine.create(resolveConfig('blackjack', { decks: 1 }), ctx);
  const r = engine.sitDown(st, 0, { userId: 'u', name: 'Ana', isBot: false }, 1000, ctx);
  if (isEngineError(r)) throw new Error(r.error);
  st = engine.advance(r.state, ctx).state; // abre apostas
  const filler = Array.from({ length: 30 }, () => c('2c'));
  st = { ...st, shoe: [...filler, ...draws.map(c).reverse()] };
  return st;
}
function act(st: State, a: Action): State {
  const r = engine.applyAction(st, 0, a, ctx);
  if (isEngineError(r)) throw new Error(r.error);
  return r.state;
}
function runDealer(st: State): State {
  for (let i = 0; i < 10 && st.phase === 'dealer'; i++) st = engine.advance(st, ctx).state;
  return st;
}

describe('blackjack', () => {
  it('totais soft/hard', () => {
    expect(handValue(['AS', 'KH'].map(c))).toEqual({ total: 21, soft: true });
    expect(handValue(['AS', '6H'].map(c))).toEqual({ total: 17, soft: true });
    expect(handValue(['AS', '6H', 'KD'].map(c))).toEqual({ total: 17, soft: false });
    expect(handValue(['AS', 'AH', '9D'].map(c))).toEqual({ total: 21, soft: true });
  });

  it('blackjack paga 3:2 (arredonda para baixo)', () => {
    let st = setup(['As', '9d', 'Kh', '7c']);
    st = act(st, { type: 'bet', amount: 15 });
    st = runDealer(st);
    expect(st.phase).toBe('result');
    expect(engine.getStacks(st)[0]).toBe(1000 - 15 + 15 + 22);
    const v = engine.getView(st, 0) as View;
    expect(v.seats[0]!.hands[0].outcome).toBe('blackjack');
    expect(v.seats[0]!.hands[0].label).toBe('BJ');
  });

  it('empate devolve a aposta', () => {
    let st = setup(['Td', 'Th', '8d', '8h']);
    st = act(st, { type: 'bet', amount: 100 });
    expect(engine.getTurn(st).seats).toEqual([0]);
    st = act(st, { type: 'stand' });
    st = runDealer(st);
    expect(st.phase).toBe('result');
    expect(engine.getStacks(st)[0]).toBe(1000);
    expect((engine.getView(st, 0) as View).seats[0]!.hands[0].outcome).toBe('push');
  });

  it('dobrar: aposta dobra, uma carta, banca estoura', () => {
    let st = setup(['5h', '6d', '6h', 'Td', '9c', '8s']);
    st = act(st, { type: 'bet', amount: 50 });
    st = act(st, { type: 'double' });
    expect(st.phase).toBe('dealer');
    st = runDealer(st);
    expect(st.phase).toBe('result');
    expect(engine.getStacks(st)[0]).toBe(1100);
    expect(st.dealer.length).toBe(3);
  });

  it('simulação: stacks nunca negativos e views JSON (5 seeds)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const stacks = [500, 800, 300, 1000, 600];
      simulateSession(engine, resolveConfig('blackjack', {}), stacks, 1500, {
        seed, checkViews: true,
        onState: (st: State) => {
          for (const v of Object.values(engine.getStacks(st))) expect(v).toBeGreaterThanOrEqual(0);
        },
      });
    }
  }, 120_000);
});
