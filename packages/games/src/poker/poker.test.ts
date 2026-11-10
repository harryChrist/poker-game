import { describe, expect, it } from 'vitest';
import { makeCard, resolveConfig, isHidden, type Card, type Rank, type Suit } from '@cards/shared';
import { simulateSession } from '../testing';
import { engine } from './index';
import { evaluate, scoreCards } from './evaluator';
import { computePots, potTotal } from './rules';
import type { State, View } from './types';

const c = (s: string): Card => makeCard(s[0] as Rank, s[1].toUpperCase() as Suit);
const hand = (s: string) => s.split(' ').map(c);
const score = (s: string) => scoreCards(hand(s));

describe('avaliador', () => {
  it('categorias e nomes', () => {
    expect(evaluate(hand('As Ks Qs Js Ts 2d 3c')).name).toBe('Royal Flush');
    expect(evaluate(hand('9s 8s 7s 6s 5s 2d 3c')).name).toBe('Straight Flush');
    expect(evaluate(hand('9s 9h 9d 9c 5s 2d 3c')).name).toBe('Quadra');
    expect(evaluate(hand('9s 9h 9d 5c 5s 2d 3c')).name).toBe('Full House');
    expect(evaluate(hand('As 9s 7s 5s 2s Kd 3c')).name).toBe('Flush');
    expect(evaluate(hand('9s 8h 7d 6c 5s 2d 2c')).name).toBe('Sequência');
    expect(evaluate(hand('9s 9h 9d 6c 5s 2d Kc')).name).toBe('Trinca de Noves');
    expect(evaluate(hand('Ks 9h 9d 6c 6s 2d Kc')).name).toBe('Dois Pares');
    expect(evaluate(hand('Ks Kh 9d 6c 5s 2d 3c')).name).toBe('Par de Reis');
    expect(evaluate(hand('As Kh 9d 6c 5s 2d 3c')).name).toBe('Carta Alta');
  });
  it('ordem entre categorias e desempates', () => {
    expect(score('9s 9h 9d 9c 5s 2d 3c')).toBeGreaterThan(score('As Ah Ad Kc Ks 2d 3c'));
    expect(score('As 9s 7s 5s 2s Kd 3c')).toBeGreaterThan(score('9s 8h 7d 6c 5s 2d 2c'));
    // kicker
    expect(score('As Ah Kd 6c 5s 2d 3c')).toBeGreaterThan(score('Ac Ad Qd 6h 5d 2s 3h'));
    // dois pares: kicker
    expect(score('Ks Kh 9d 9c As 2d 3c')).toBeGreaterThan(score('Kc Kd 9h 9s Qs 2h 3d'));
    // board jogado = empate
    expect(score('As Ks Qs Js 9s 2d 3c')).toBe(score('As Ks Qs Js 9s 4d 5c'));
  });
  it('wheel (A-2-3-4-5) é a sequência mais baixa', () => {
    const wheel = score('As 2h 3d 4c 5s 9d Kc');
    expect(evaluate(hand('As 2h 3d 4c 5s 9d Kc')).name).toBe('Sequência');
    expect(wheel).toBeLessThan(score('2s 3h 4d 5c 6s 9d Kc'));
    expect(wheel).toBeGreaterThan(score('As Ah Kd Qc Js 9d 2c'));
    expect(evaluate(hand('As 2h 3d 4c 5s 9d Kc')).best.map((x) => x.id).sort()).toEqual(['2H', '3D', '4C', '5S', 'AS']);
  });
});

describe('potes', () => {
  it('side pots com 3 all-ins diferentes', () => {
    const pots = computePots([
      { seat: 0, amount: 100, live: true },
      { seat: 1, amount: 300, live: true },
      { seat: 2, amount: 500, live: true },
      { seat: 3, amount: 500, live: true },
      { seat: 4, amount: 50, live: false },
    ]);
    expect(pots).toEqual([
      { amount: 100 * 4 + 50, eligible: [0, 1, 2, 3] },
      { amount: 200 * 3, eligible: [1, 2, 3] },
      { amount: 200 * 2, eligible: [2, 3] },
    ]);
    expect(pots.reduce((a, p) => a + p.amount, 0)).toBe(1450);
  });
});

describe('simulação', () => {
  const config = resolveConfig('poker', { seats: 6 });
  it('conserva fichas, termina e não vaza cartas (5 seeds)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const stacks = [1000, 1000, 1500, 800, 1200, 1000];
      const total = stacks.reduce((a, b) => a + b, 0);
      const { cashOut } = simulateSession(engine, config, stacks, 1500, {
        seed, timeoutRate: 0.1,
        onState: (st: State) => {
          const sum = Object.values(engine.getStacks(st)).reduce((a, b) => a + b, 0) + potTotal(st);
          expect(sum).toBe(total);
          for (let seat = 0; seat < stacks.length; seat++) {
            const v = engine.getView(st, seat) as View;
            if (v.showdown) continue;
            v.seats.forEach((sv, i) => {
              if (!sv || i === seat) return;
              expect(sv.cards.every((cd) => isHidden(cd))).toBe(true);
            });
          }
          const spec = engine.getView(st, null) as View;
          if (!spec.showdown) spec.seats.forEach((sv) => sv && expect(sv.cards.every((cd) => isHidden(cd))).toBe(true));
        },
      });
      expect(cashOut.reduce((a, b) => a + b, 0)).toBe(total);
    }
  }, 120_000);
  it('heads-up: botão é small blind e age primeiro no pré-flop', () => {
    const ctx = { rng: () => 0.3, now: 0 };
    let st = engine.create(resolveConfig('poker', {}), ctx);
    for (const seat of [0, 1]) {
      const r = engine.sitDown(st, seat, { userId: `u${seat}`, name: `J${seat}`, isBot: false }, 1000, ctx);
      if ('error' in r) throw new Error(r.error);
      st = r.state;
    }
    st = engine.advance(st, ctx).state;
    const v = engine.getView(st, 0) as View;
    const btn = v.seats[v.button]!;
    expect(btn.isSB).toBe(true);
    expect(v.turnSeat).toBe(v.button);
    expect(engine.getTurn(st).seats).toEqual([v.button]);
  });
});
