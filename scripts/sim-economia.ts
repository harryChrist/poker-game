/**
 * Simulação da economia dos jogos (rodar: npx tsx scripts/sim-economia.ts).
 * Usa os motores reais com bots jogando e mede quanto as fichas mudam.
 */
import { createRng, isEngineError, type SessionEngine, type MatchEngine } from '@cards/shared';
import { ENGINES } from '@cards/games';
import { GAMES, resolveConfig } from '@cards/shared';

function bots(n: number) {
  return Array.from({ length: n }, (_, i) => ({ userId: `b${i}`, name: `Bot ${i}`, isBot: true }));
}

/** Blackjack: N jogadores com estratégia de bot contra a banca. Retorna resultado líquido / total apostado. */
function simBlackjack(rounds: number, seed: number) {
  const eng = ENGINES.blackjack as SessionEngine;
  const rng = createRng(seed);
  const ctx = () => ({ rng, now: Date.now() });
  const config = resolveConfig('blackjack', { seats: 5 });
  let s = eng.create(config, ctx());
  const START = 10_000_000;
  for (let i = 0; i < 5; i++) {
    const r = eng.sitDown(s, i, bots(5)[i], START, ctx());
    if (isEngineError(r)) throw new Error(r.error);
    s = r.state;
  }
  let wagered = 0;
  let pending = true;
  let lastRound = 0;
  for (let step = 0; step < rounds * 60; step++) {
    const turn = eng.getTurn(s);
    if (turn.seats.length) {
      const seat = turn.seats[0];
      const a = eng.botAction(s, seat, ctx());
      if (a.type === 'bet') wagered += a.amount;
      const before = eng.getStacks(s)[seat];
      const r = eng.applyAction(s, seat, a, ctx());
      if (isEngineError(r)) throw new Error(`${r.error} ${JSON.stringify(a)}`);
      // dobrar/dividir também colocam fichas na mesa
      if (a.type === 'double' || a.type === 'split') wagered += Math.max(0, before - eng.getStacks(r.state)[seat]);
      s = r.state;
      if (r.advanceInMs !== undefined) pending = true;
    } else if (pending) {
      const r = eng.advance(s, ctx());
      s = r.state;
      pending = r.advanceInMs !== undefined;
    } else break;
    const round = (s as any).round as number;
    if (round > rounds) break;
    lastRound = round;
  }
  const stacks = eng.getStacks(s);
  const total = Object.values(stacks).reduce((a, b) => a + b, 0);
  const net = total - START * 5;
  return { rounds: lastRound, wagered, net, edgePct: (net / wagered) * 100 };
}

/** Poker: conservação — soma das fichas antes e depois tem que ser igual (ninguém cria fichas). */
function simPoker(steps: number, seed: number) {
  const eng = ENGINES.poker as SessionEngine;
  const rng = createRng(seed);
  const ctx = () => ({ rng, now: Date.now() });
  let s = eng.create(resolveConfig('poker', { seats: 6 }), ctx());
  for (let i = 0; i < 6; i++) s = (eng.sitDown(s, i, bots(6)[i], 4000, ctx()) as any).state;
  let pending = true;
  for (let step = 0; step < steps; step++) {
    const turn = eng.getTurn(s);
    if (turn.seats.length) {
      const r = eng.applyAction(s, turn.seats[0], eng.botAction(s, turn.seats[0], ctx()), ctx());
      if (isEngineError(r)) throw new Error(r.error);
      s = r.state;
      if (r.advanceInMs !== undefined) pending = true;
    } else if (pending) {
      const r = eng.advance(s, ctx());
      s = r.state;
      pending = r.advanceInMs !== undefined;
    } else break;
  }
  let cash = 0;
  for (let i = 0; i < 6; i++) {
    const r = eng.standUp(s, i, ctx());
    s = r.state;
    cash += r.cashOut;
  }
  return { start: 6 * 4000, end: cash };
}

/** Partidas com aposta: com todos jogando igual (bots), cada assento deveria vencer ~1/N das vezes. */
function simMatch(gameId: 'truco' | 'bisca' | 'sueca' | 'copas' | 'fodinha' | 'cacheta' | 'pife', games: number, players: number) {
  const eng = ENGINES[gameId] as MatchEngine;
  const config = resolveConfig(gameId, { players });
  const n = GAMES[gameId].economy === 'match' ? config.players : players;
  const stake = 100;
  // economia igual ao servidor: pote = aposta × assentos, dividido entre os vencedores
  let seat0 = 0;
  let wins0 = 0;
  for (let g = 0; g < games; g++) {
    const rng = createRng(1000 + g);
    const ctx = () => ({ rng, now: Date.now() });
    let r = eng.create(config, bots(n), ctx());
    let s = r.state;
    let pending = r.advanceInMs !== undefined;
    for (let step = 0; step < 200_000; step++) {
      if (eng.getResult(s)) break;
      const turn = eng.getTurn(s);
      if (turn.seats.length) {
        const out = eng.applyAction(s, turn.seats[0], eng.botAction(s, turn.seats[0], ctx()), ctx());
        if (isEngineError(out)) throw new Error(out.error);
        s = out.state;
        if (out.advanceInMs !== undefined) pending = true;
      } else if (pending) {
        const out = eng.advance(s, ctx());
        s = out.state;
        pending = out.advanceInMs !== undefined;
      } else break;
    }
    const res = eng.getResult(s)!;
    const winners = [...new Set(res.winners)];
    const pot = stake * n;
    const each = winners.length ? Math.floor(pot / winners.length) : 0;
    const got = winners.length ? (winners.includes(0) ? each : 0) : stake;
    seat0 += got - stake;
    if (winners.includes(0)) wins0++;
  }
  return { games, players: n, winRate: wins0 / games, avgNetPerGame: seat0 / games };
}

const t0 = Date.now();
console.log('BLACKJACK (5 bots com estratégia básica, banca deveria ganhar ~0,5%):');
for (const seed of [1, 2, 3]) {
  const r = simBlackjack(4000, seed);
  console.log(`  seed ${seed}: ${r.rounds} rodadas, apostado ${r.wagered}, resultado dos jogadores ${r.net} (${r.edgePct.toFixed(2)}% do apostado)`);
}
console.log('POKER (conservação de fichas):');
for (const seed of [1, 2]) {
  const r = simPoker(20_000, seed);
  console.log(`  seed ${seed}: entrou ${r.start}, saiu ${r.end} ${r.start === r.end ? 'OK' : 'ERRO'}`);
}
console.log('PARTIDAS (assento 0 vs bots iguais; esperado: ganha ~1/N, saldo médio ~0):');
for (const [g, p] of [['truco', 2], ['truco', 4], ['bisca', 2], ['sueca', 4], ['copas', 4], ['fodinha', 4], ['cacheta', 4], ['pife', 3]] as const) {
  const r = simMatch(g, g === 'copas' || g === 'fodinha' || g === 'cacheta' ? 60 : 120, p);
  console.log(`  ${g} ${r.players}p: vence ${(r.winRate * 100).toFixed(0)}% · saldo médio por partida ${r.avgNetPerGame.toFixed(1)} (aposta 100)`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
