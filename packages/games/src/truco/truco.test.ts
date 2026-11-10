import { describe, expect, it } from 'vitest';
import { createRng, isEngineError, makeCard, type Card, type Rank, type Suit, type EngineCtx } from '@cards/shared';
import { bots, simulateMatch } from '../testing';
import { engine, startHand } from './engine';
import { cardPower, decideHand, nextRank, resolveTrick } from './rules';
import type { Action, Play, Team, TrucoState, TrucoView } from './types';

const c = (r: Rank, s: Suit): Card => makeCard(r, s);
const ctx = (seed = 7): EngineCtx => ({ rng: createRng(seed), now: 0 });

/** Cria uma mão de truco com cartas definidas. vira 'J' => manilha 'K' etc. */
function setup(opts: {
  n?: 2 | 4;
  hands: Card[][];
  vira?: Card;
  scores?: [number, number];
  handSeat?: number;
}): TrucoState {
  const n = opts.n ?? 2;
  const created = engine.create({ turnSeconds: 25 }, bots(n), ctx()).state;
  const s: TrucoState = structuredClone(created);
  s.scores = opts.scores ?? [0, 0];
  s.handSeat = opts.handSeat ?? 0;
  startHand(s, createRng(3));
  s.hands = opts.hands.map((h) => h.slice());
  if (opts.vira) {
    s.vira = opts.vira;
    s.manilha = nextRank(opts.vira.r);
  }
  return s;
}

function act(s: TrucoState, seat: number, a: Action): TrucoState {
  const r = engine.applyAction(s, seat, a, ctx());
  if (isEngineError(r)) throw new Error(`Erro inesperado: ${r.error}`);
  return r.state;
}
function actErr(s: TrucoState, seat: number, a: Action): string {
  const r = engine.applyAction(s, seat, a, ctx());
  if (!isEngineError(r)) throw new Error('Esperava erro');
  return r.error;
}
const adv = (s: TrucoState) => engine.advance(s, ctx()).state;
const play = (s: TrucoState, seat: number, id: string, hidden = false) => act(s, seat, { type: 'play', cardId: id, hidden });

describe('truco: regras de cartas', () => {
  it('manilha é a próxima carta depois da vira (3 -> 4)', () => {
    expect(nextRank('3')).toBe('4');
    expect(nextRank('4')).toBe('5');
    expect(nextRank('7')).toBe('Q');
    expect(nextRank('K')).toBe('A');
    expect(nextRank('A')).toBe('2');
    expect(nextRank('2')).toBe('3');
  });

  it('ordem das cartas comuns e das manilhas por naipe', () => {
    const ordem: Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
    // manilha = 'Z' inexistente no baralho: nenhuma é manilha. Usa vira 3 de espadas => manilha 4, então remove o 4
    const rest = ordem.slice(1);
    for (let i = 0; i + 1 < rest.length; i++) {
      expect(cardPower(c(rest[i], 'S'), '4')).toBeLessThan(cardPower(c(rest[i + 1], 'S'), '4'));
    }
    const m = (s: Suit) => cardPower(c('4', s), '4');
    expect(m('D')).toBeLessThan(m('S'));
    expect(m('S')).toBeLessThan(m('H'));
    expect(m('H')).toBeLessThan(m('C'));
    expect(m('D')).toBeGreaterThan(cardPower(c('3', 'C'), '4'));
  });

  it('resolveTrick: maior vence, encoberta perde e empate entre times é cangou', () => {
    const P = (seat: number, card: Card, hidden = false): Play => ({ seat, card, hidden });
    expect(resolveTrick([P(0, c('A', 'S')), P(1, c('2', 'S'))], 'K').winnerSeat).toBe(1);
    expect(resolveTrick([P(0, c('3', 'S')), P(1, c('3', 'H'))], 'K')).toEqual({ winnerSeat: null, winnerTeam: null });
    expect(resolveTrick([P(0, c('4', 'S'), true), P(1, c('5', 'S'))], 'K').winnerSeat).toBe(1);
    expect(resolveTrick([P(0, c('K', 'D')), P(1, c('3', 'S'))], 'K').winnerSeat).toBe(0);
    // duas encobertas de times diferentes empatam
    expect(resolveTrick([P(0, c('4', 'S'), true), P(1, c('5', 'S'), true)], 'K').winnerTeam).toBeNull();
  });

  it('em duplas, cartas iguais de parceiros não empatam', () => {
    const P = (seat: number, card: Card): Play => ({ seat, card, hidden: false });
    const r = resolveTrick([P(0, c('3', 'S')), P(1, c('2', 'S')), P(2, c('3', 'H')), P(3, c('A', 'S'))], 'K');
    expect(r.winnerTeam).toBe(0);
    expect(r.winnerSeat).toBe(0);
    // cartas iguais de times diferentes empatam
    const r2 = resolveTrick([P(0, c('3', 'S')), P(1, c('3', 'H')), P(2, c('4', 'S')), P(3, c('5', 'S'))], 'K');
    expect(r2.winnerTeam).toBeNull();
  });

  it('decideHand: cangou', () => {
    const T = (...x: (Team | null)[]) => decideHand(x);
    expect(T(0)).toEqual({ done: false, winnerTeam: null });
    expect(T(0, 0)).toEqual({ done: true, winnerTeam: 0 });
    expect(T(0, null)).toEqual({ done: true, winnerTeam: 0 }); // 1ª ganha, 2ª empata: vence quem ganhou a 1ª
    expect(T(null, 1)).toEqual({ done: true, winnerTeam: 1 }); // 1ª empata, vence quem ganhar a 2ª
    expect(T(null, null)).toEqual({ done: false, winnerTeam: null });
    expect(T(null, null, 1)).toEqual({ done: true, winnerTeam: 1 });
    expect(T(null, null, null)).toEqual({ done: true, winnerTeam: null }); // ninguém pontua
    expect(T(0, 1)).toEqual({ done: false, winnerTeam: null });
    expect(T(0, 1, 1)).toEqual({ done: true, winnerTeam: 1 });
    expect(T(0, 1, null)).toEqual({ done: true, winnerTeam: 0 }); // 3ª empata: vence quem ganhou a 1ª
    expect(T(1, 0, null)).toEqual({ done: true, winnerTeam: 1 });
  });
});

describe('truco: fluxo de mão (1x1)', () => {
  // vira 7 de ouros => manilha Q
  const vira = c('7', 'D');

  it('mão simples: 2 vazas seguidas, vencedor ganha 1 ponto e há pausas', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira });
    expect(engine.getTurn(s).seats).toEqual([0]);
    s = play(s, 0, '3S');
    expect(engine.getTurn(s).seats).toEqual([1]);
    const r1 = engine.applyAction(s, 1, { type: 'play', cardId: '2H' }, ctx());
    if (isEngineError(r1)) throw new Error(r1.error);
    expect(r1.advanceInMs).toBe(1200);
    s = r1.state;
    expect(engine.getTurn(s).seats).toEqual([]);
    expect(actErr(s, 0, { type: 'play', cardId: '4S' })).toMatch(/Aguarde/);
    s = adv(s);
    expect(engine.getTurn(s).seats).toEqual([0]); // quem ganhou (3S) começa
    s = play(s, 0, '4S');
    const r2 = engine.applyAction(s, 1, { type: 'play', cardId: '4H' }, ctx());
    if (isEngineError(r2)) throw new Error(r2.error);
    // 4S x 4H empata (cangou) depois de 0 ter ganhado a 1ª: 0 ganha a mão
    expect(r2.advanceInMs).toBe(3000);
    s = r2.state;
    expect(s.scores).toEqual([1, 0]);
    expect(s.handResult?.winnerTeam).toBe(0);
    s = adv(s);
    expect(s.handNo).toBe(2);
    expect(s.handSeat).toBe(1);
    expect(s.hands.every((h) => h.length === 3)).toBe(true);
    expect(engine.getTurn(s).seats).toEqual([1]);
  });

  it('1ª empata, vence quem ganhar a 2ª', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('3', 'H'), c('6', 'H'), c('5', 'H')]], vira });
    s = play(s, 0, '3S');
    s = play(s, 1, '3H'); // empate
    expect(s.tricks[0].winnerTeam).toBeNull();
    s = adv(s);
    expect(engine.getTurn(s).seats).toEqual([0]); // quem abriu a vaza empatada abre a próxima
    s = play(s, 0, '4S');
    s = play(s, 1, '6H'); // 6 > 4: time 1 ganha a 2ª e a mão
    expect(s.scores).toEqual([0, 1]);
  });

  it('as três vazas empatadas: ninguém pontua', () => {
    let s = setup({
      hands: [[c('3', 'S'), c('2', 'S'), c('A', 'S')], [c('3', 'H'), c('2', 'H'), c('A', 'H')]], vira,
    });
    for (const [a, b] of [['3S', '3H'], ['2S', '2H'], ['AS', 'AH']]) {
      s = play(s, 0, a);
      s = play(s, 1, b);
      if (s.phase === 'pause' && s.pause === 'trick') s = adv(s);
    }
    expect(s.scores).toEqual([0, 0]);
    expect(s.handResult?.winnerTeam).toBeNull();
    expect(s.handResult?.reason).toBe('tie');
  });

  it('3 vazas: 1ª de um, 2ª do outro, 3ª decide', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('Q', 'S')], [c('2', 'H'), c('5', 'H'), c('4', 'H')]], vira });
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s); // 0 ganha
    s = play(s, 0, '4S'); s = play(s, 1, '5H'); s = adv(s); // 1 ganha
    expect(s.tricks.map((t) => t.winnerTeam)).toEqual([0, 1]);
    expect(engine.getTurn(s).seats).toEqual([1]);
    s = play(s, 1, '4H'); s = play(s, 0, 'QS'); // QS é manilha
    expect(s.scores).toEqual([1, 0]);
  });

  it('manilha vence o 3; zap é a maior', () => {
    let s = setup({ hands: [[c('Q', 'D'), c('4', 'S'), c('5', 'S')], [c('3', 'S'), c('4', 'H'), c('5', 'H')]], vira });
    s = play(s, 0, 'QD'); s = play(s, 1, '3S');
    expect(s.tricks[0].winnerSeat).toBe(0);
    let s2 = setup({ hands: [[c('Q', 'D'), c('4', 'S'), c('5', 'S')], [c('Q', 'C'), c('4', 'H'), c('5', 'H')]], vira });
    s2 = play(s2, 0, 'QD'); s2 = play(s2, 1, 'QC');
    expect(s2.tricks[0].winnerSeat).toBe(1);
  });

  it('carta encoberta: só a partir da 2ª vaza e vale zero', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('6', 'H')]], vira });
    expect(actErr(s, 0, { type: 'play', cardId: '4S', hidden: true })).toMatch(/2ª vaza/);
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s);
    s = act(s, 0, { type: 'play', cardId: '5S', hidden: true });
    // a view do adversário não revela a carta encoberta
    const v = engine.getView(s, 1) as TrucoView;
    expect(v.table).toEqual([{ seat: 0, card: { hidden: true } }]);
    expect(JSON.stringify(v)).not.toContain('"id":"5S"');
    s = play(s, 1, '4H'); // 4 > encoberta
    expect(s.tricks[1].winnerSeat).toBe(1);
    expect(s.tricks[1].plays[0].hidden).toBe(true);
  });

  it('jogar fora de vez ou carta inválida dá erro em português', () => {
    const s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('6', 'H')]], vira });
    expect(actErr(s, 1, { type: 'play', cardId: '2H' })).toMatch(/vez/);
    expect(actErr(s, 0, { type: 'play', cardId: '2H' })).toMatch(/inválida/);
    expect(actErr(s, 0, { type: 'accept' })).toMatch(/pedido/);
    expect(actErr(s, 0, { type: 'xyz' } as any)).toMatch(/desconhecida/);
  });
});

describe('truco: pedidos (truco, seis, nove, doze, correr)', () => {
  const vira = c('7', 'D');
  const H = (): Card[][] => [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]];

  it('truco aceito vale 3', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' });
    expect(s.phase).toBe('respond');
    expect(engine.getTurn(s).seats).toEqual([1]);
    expect((engine.getView(s, 1) as TrucoView).legal).toMatchObject({ kind: 'respond', pendingValue: 3, canRaise: true, raiseLabel: 'SEIS', runPoints: 1 });
    expect(actErr(s, 0, { type: 'accept' })).toMatch(/pedido/);
    s = act(s, 1, { type: 'accept' });
    expect(s.value).toBe(3);
    expect(engine.getTurn(s).seats).toEqual([0]); // quem pediu ainda precisa jogar
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s);
    s = play(s, 0, '4S'); s = play(s, 1, '4H');
    expect(s.scores).toEqual([3, 0]);
  });

  it('truco recusado: quem pediu marca 1', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' });
    const r = engine.applyAction(s, 1, { type: 'run' }, ctx());
    if (isEngineError(r)) throw new Error(r.error);
    expect(r.advanceInMs).toBe(3000);
    expect(r.state.scores).toEqual([1, 0]);
    expect(r.state.handResult?.reason).toBe('run');
  });

  it('escada truco -> seis -> nove -> doze e aceitar vale 12', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' });
    s = act(s, 1, { type: 'raise' });
    expect(s.pendingValue).toBe(6);
    expect(s.value).toBe(3);
    expect(engine.getTurn(s).seats).toEqual([0]);
    s = act(s, 0, { type: 'raise' });
    expect(s.pendingValue).toBe(9);
    s = act(s, 1, { type: 'raise' });
    expect(s.pendingValue).toBe(12);
    expect((engine.getView(s, 0) as TrucoView).legal).toMatchObject({ kind: 'respond', canRaise: false });
    expect(actErr(s, 0, { type: 'raise' })).toMatch(/aumentar/);
    s = act(s, 0, { type: 'accept' });
    expect(s.value).toBe(12);
    // ninguém pode pedir mais
    expect(actErr(s, 0, { type: 'truco' })).toBeTruthy();
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s);
    s = play(s, 0, '4S'); s = play(s, 1, '4H');
    expect(s.scores).toEqual([12, 0]);
    expect(engine.getResult(s)).toEqual({ winners: [0], summary: 'Bot 0 venceu por 12 a 0' });
  });

  it('seis recusado: quem pediu seis marca o valor aceito (3)', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' });
    s = act(s, 1, { type: 'raise' }); // seis
    s = act(s, 0, { type: 'run' });
    expect(s.scores).toEqual([0, 3]);
  });

  it('nove recusado marca 6; doze recusado marca 9', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' }); s = act(s, 1, { type: 'raise' }); s = act(s, 0, { type: 'raise' });
    const nine = act(s, 1, { type: 'run' });
    expect(nine.scores).toEqual([6, 0]);
    s = act(s, 1, { type: 'raise' }); // doze
    expect(act(s, 0, { type: 'run' }).scores).toEqual([0, 9]);
  });

  it('só o time que não fez o último pedido pode aumentar', () => {
    let s = setup({ hands: H(), vira });
    s = act(s, 0, { type: 'truco' });
    s = act(s, 1, { type: 'accept' });
    // vez do 0 de jogar: ele fez o último pedido, não pode aumentar
    expect((engine.getView(s, 0) as TrucoView).legal).toMatchObject({ kind: 'play', canTruco: false });
    expect(actErr(s, 0, { type: 'truco' })).toMatch(/não pode/);
    s = play(s, 0, '3S');
    // agora 1 (que aceitou) pode pedir seis
    const leg = (engine.getView(s, 1) as TrucoView).legal;
    expect(leg).toMatchObject({ kind: 'play', canTruco: true, trucoLabel: 'SEIS', trucoValue: 6 });
    s = act(s, 1, { type: 'truco' });
    expect(s.pendingValue).toBe(6);
    s = act(s, 0, { type: 'accept' });
    expect(s.value).toBe(6);
  });

  it('só pede truco na sua vez; durante a resposta não se joga carta', () => {
    let s = setup({ hands: H(), vira });
    expect(actErr(s, 1, { type: 'truco' })).toMatch(/vez/);
    s = act(s, 0, { type: 'truco' });
    expect(actErr(s, 0, { type: 'play', cardId: '3S' })).toMatch(/Responda/);
  });

  it('4 jogadores: responde o próximo adversário em ordem; parceiro não responde', () => {
    const hands = [
      [c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')],
      [c('A', 'S'), c('4', 'D'), c('5', 'D')], [c('K', 'H'), c('6', 'H'), c('6', 'D')],
    ];
    let s = setup({ n: 4, hands, vira });
    s = act(s, 0, { type: 'truco' });
    expect(engine.getTurn(s).seats).toEqual([1]);
    expect(actErr(s, 2, { type: 'accept' })).toMatch(/pedido/);
    expect(actErr(s, 3, { type: 'accept' })).toMatch(/pedido/);
    s = act(s, 1, { type: 'raise' });
    // quem pediu seis foi o 1; responde o próximo adversário a partir dele: seat 2
    expect(engine.getTurn(s).seats).toEqual([2]);
    s = act(s, 2, { type: 'run' });
    expect(s.scores).toEqual([0, 3]); // time 1 marca o valor aceito (3)
  });

  it('pontuação limitada a 12 e partida termina', () => {
    let s = setup({ hands: H(), vira, scores: [10, 5] });
    s = act(s, 0, { type: 'truco' });
    s = act(s, 1, { type: 'accept' });
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s);
    s = play(s, 0, '4S'); s = play(s, 1, '4H');
    expect(s.scores).toEqual([12, 5]);
    expect(s.phase).toBe('over');
    expect(engine.getResult(s)?.winners).toEqual([0]);
    expect(engine.getTurn(s).seats).toEqual([]);
  });
});

describe('truco: mão de onze e mão de ferro', () => {
  const vira = c('7', 'D');
  const hands4 = (): Card[][] => [
    [c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')],
    [c('A', 'S'), c('4', 'D'), c('5', 'D')], [c('K', 'H'), c('6', 'H'), c('6', 'D')],
  ];

  it('mão de onze (2x2): time com 11 vê as cartas do parceiro e decide', () => {
    const s = setup({ n: 4, hands: hands4(), vira, scores: [11, 4], handSeat: 1 });
    expect(s.mode).toBe('onze');
    expect(s.phase).toBe('decide11');
    // quem decide: primeiro do time 0 a partir da mão (seat 1 -> 2)
    expect(engine.getTurn(s).seats).toEqual([2]);
    const v2 = engine.getView(s, 2) as TrucoView;
    expect(v2.legal).toEqual({ kind: 'decide11' });
    expect(v2.partnerHand?.map((x) => x.id)).toEqual(['3S', '4S', '5S']);
    const v0 = engine.getView(s, 0) as TrucoView;
    expect(v0.partnerHand?.map((x) => x.id)).toEqual(['AS', '4D', '5D']);
    expect((engine.getView(s, 1) as TrucoView).partnerHand).toBeNull();
    expect((engine.getView(s, 3) as TrucoView).partnerHand).toBeNull();
    expect(JSON.stringify(engine.getView(s, 1))).not.toContain('"id":"3S"');
    expect(actErr(s, 0, { type: 'play11' })).toMatch(/onze/);
    expect(actErr(s, 2, { type: 'play', cardId: 'AS' })).toMatch(/onze/);
  });

  it('jogar a mão de onze vale 3, sem truco; depois a view não mostra mais o parceiro', () => {
    let s = setup({ n: 4, hands: hands4(), vira, scores: [11, 4], handSeat: 0 });
    s = act(s, 0, { type: 'play11' });
    expect(s.value).toBe(3);
    expect(s.phase).toBe('play');
    expect(engine.getTurn(s).seats).toEqual([0]); // mão joga primeiro
    expect((engine.getView(s, 0) as TrucoView).partnerHand).toBeNull();
    expect((engine.getView(s, 0) as TrucoView).legal).toMatchObject({ kind: 'play', canTruco: false });
    expect(actErr(s, 0, { type: 'truco' })).toMatch(/Não é permitido/);
  });

  it('time que vence a mão de onze fecha o jogo (11+3 limitado a 12)', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira, scores: [11, 4], handSeat: 0 });
    s = act(s, 0, { type: 'play11' });
    s = play(s, 0, '3S'); s = play(s, 1, '2H'); s = adv(s);
    s = play(s, 0, '4S'); s = play(s, 1, '4H');
    expect(s.scores[0]).toBe(12);
    expect(engine.getResult(s)?.summary).toBe('Bot 0 venceu por 12 a 4');
  });

  it('correr da mão de onze dá 1 ponto ao adversário', () => {
    let s = setup({ n: 4, hands: hands4(), vira, scores: [3, 11], handSeat: 0 });
    expect(s.onzeTeam).toBe(1);
    expect(engine.getTurn(s).seats).toEqual([1]);
    const r = engine.applyAction(s, 1, { type: 'run11' }, ctx());
    if (isEngineError(r)) throw new Error(r.error);
    expect(r.state.scores).toEqual([4, 11]);
    expect(r.state.handResult?.reason).toBe('run11');
    expect(r.advanceInMs).toBe(3000);
    s = adv(r.state);
    expect(s.phase).toBe('decide11'); // 11 continua: nova decisão na próxima mão
  });

  it('mão de ferro (11 x 11): mão escondida, joga pelo índice, sem truco, vale 1', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira, scores: [11, 11] });
    expect(s.mode).toBe('ferro');
    expect(s.phase).toBe('play');
    const v = engine.getView(s, 0) as TrucoView;
    expect(v.myHand).toEqual([{ hidden: true }, { hidden: true }, { hidden: true }]);
    expect(JSON.stringify(v)).not.toContain('"id":"3S"');
    expect(v.legal).toMatchObject({ kind: 'play', byIndex: true, canTruco: false });
    expect(actErr(s, 0, { type: 'truco' })).toMatch(/Não é permitido/);
    s = act(s, 0, { type: 'play', index: 0 }); // 3S
    expect(s.table[0].card.id).toBe('3S');
    expect(actErr(s, 1, { type: 'play', index: 7 })).toMatch(/inválida/);
    s = act(s, 1, { type: 'play', index: 0 }); // 2H
    s = adv(s);
    expect(s.value).toBe(1);
    s = act(s, 0, { type: 'play', index: 0 }); s = act(s, 1, { type: 'play', index: 0 });
    expect(s.scores).toEqual([12, 11]); // vale 1
  });
});

describe('truco: ações automáticas', () => {
  const vira = c('7', 'D');
  it('timeoutAction: correr, mão de onze com/sem manilha, menor carta', () => {
    let s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('Q', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira });
    expect(engine.timeoutAction(s, 0)).toEqual({ type: 'play', cardId: '4S' });
    s = act(s, 0, { type: 'truco' });
    expect(engine.timeoutAction(s, 1)).toEqual({ type: 'run' });
    const withManilha = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('Q', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira, scores: [11, 2] });
    expect(engine.timeoutAction(withManilha, 0)).toEqual({ type: 'play11' });
    const without = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira, scores: [11, 2] });
    expect(engine.timeoutAction(without, 0)).toEqual({ type: 'run11' });
  });

  it('replaceWithBot troca o jogador por bot sem mutar', () => {
    const s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira });
    const before = JSON.stringify(s);
    const t = engine.replaceWithBot(s, 1, 'Robô');
    expect(JSON.stringify(s)).toBe(before);
    expect(t.players[1]).toMatchObject({ name: 'Robô', isBot: true });
  });

  it('advance sem nada pendente é seguro', () => {
    const s = setup({ hands: [[c('3', 'S'), c('4', 'S'), c('5', 'S')], [c('2', 'H'), c('4', 'H'), c('5', 'H')]], vira });
    const r = engine.advance(s, ctx());
    expect(r.state).toEqual(s);
    expect(r.advanceInMs).toBeUndefined();
  });
});

function cardIdsInJson(json: string): Set<string> {
  const out = new Set<string>();
  for (const m of json.matchAll(/"id":"([^"]+)"/g)) out.add(m[1]);
  return out;
}

describe('truco: simulação completa com bots', () => {
  for (const players of [2, 4]) {
    it(`${players} jogadores: 5 sementes terminam com visões válidas`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const { result, state } = simulateMatch(engine, { turnSeconds: 25, players }, players, { seed, checkViews: true });
        const st = state as TrucoState;
        expect(Math.max(...st.scores)).toBe(12);
        const winTeam = st.scores[0] >= 12 ? 0 : 1;
        expect(result.winners).toEqual(Array.from({ length: players }, (_, i) => i).filter((i) => i % 2 === winTeam));
        expect(result.summary).toMatch(/venceu por 12 a \d+/);
      }
    });
  }

  it('a view de um assento nunca contém cartas de mão de outro (exceto parceiro na mão de onze)', () => {
    let checked = 0;
    for (const players of [2, 4]) {
      for (let seed = 1; seed <= 10; seed++) {
        simulateMatch(engine, { turnSeconds: 25, players }, players, {
          seed,
          onState: (state: TrucoState) => {
            for (let seat = 0; seat < players; seat++) {
              const json = JSON.stringify(engine.getView(state, seat));
              const seen = cardIdsInJson(json);
              const v = engine.getView(state, seat) as TrucoView;
              const partnerOk = v.partnerHand ? new Set(v.partnerHand.map((x) => x.id)) : new Set<string>();
              state.hands.forEach((hand, other) => {
                for (const card of hand) {
                  if (other === seat && state.mode !== 'ferro') continue;
                  if (partnerOk.has(card.id)) continue;
                  expect(seen.has(card.id), `assento ${seat} vê ${card.id} do assento ${other}`).toBe(false);
                  checked++;
                }
              });
              // cartas encobertas nunca aparecem
              for (const p of state.table) if (p.hidden) expect(seen.has(p.card.id)).toBe(false);
              for (const t of state.tricks) for (const p of t.plays) if (p.hidden) expect(seen.has(p.card.id)).toBe(false);
            }
            // espectador não vê mão nenhuma
            const spec = cardIdsInJson(JSON.stringify(engine.getView(state, null)));
            for (const hand of state.hands) for (const card of hand) expect(spec.has(card.id)).toBe(false);
          },
        });
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('simulação com muitos timeouts também termina', () => {
    for (let seed = 100; seed < 110; seed++) {
      simulateMatch(engine, { turnSeconds: 25, players: 4 }, 4, { seed, timeoutRate: 0.8 });
    }
  });
});
