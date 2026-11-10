/**
 * COPAS (Hearts) — 4 jogadores, 52 cartas. Cada copa vale 1 ponto, a dama de espadas 13.
 * Passe de 3 cartas em ciclo: esquerda, direita, frente, sem passe. "Esquerda" = próximo assento (ordem crescente).
 */
import {
  deck52, shuffle,
  type Card, type EngineCtx, type EngineError, type GameEvent, type MatchEngine, type MatchResult,
  type Rank, type SeatPlayer, type StepResult, type TurnInfo,
} from '@cards/shared';
import { findCard, nextSeat, publicPlayers, sortHand, withBot, without, type Play, type PublicPlayer } from '../_tricks/common';

export const RANK_ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const TRICK_MS = 1200;
export const HAND_MS = 3000;

export type PassDir = 'left' | 'right' | 'across' | 'none';
export const PASS_CYCLE: readonly PassDir[] = ['left', 'right', 'across', 'none'];
const PASS_OFFSET: Record<PassDir, number> = { left: 1, right: 3, across: 2, none: 0 };

export type Phase = 'passing' | 'playing' | 'trickEnd' | 'handEnd' | 'over';

export interface TrickRecord {
  plays: Play[];
  winner: number;
  points: number;
}

export interface HandResult {
  /** pontos somados em cada assento nesta mão (já com o "fechar o jogo") */
  points: number[];
  /** assento que pegou todas as 26 (null = ninguém) */
  shooter: number | null;
  /** placar total depois da mão */
  scores: number[];
}

export interface State {
  players: SeatPlayer[];
  endScore: number;
  turnMs: number;
  hands: Card[][];
  /** índice da mão (0, 1, ...) — define a direção do passe */
  handNo: number;
  phase: Phase;
  passes: (string[] | null)[];
  received: string[][];
  turn: number;
  trick: Play[];
  trickWinner: number | null;
  tricksDone: number;
  heartsBroken: boolean;
  /** pontos capturados na mão (público: as cartas levadas ficam à vista) */
  handPoints: number[];
  scores: number[];
  /** quem levou a dama de espadas na mão */
  queenBy: number | null;
  lastTrick: TrickRecord | null;
  handResult: HandResult | null;
  winners: number[] | null;
}

export type Action =
  | { type: 'pass'; cardIds: string[] }
  | { type: 'play'; cardId: string };

export interface View {
  game: 'copas';
  seat: number | null;
  players: PublicPlayer[];
  phase: Phase;
  handNo: number;
  passDir: PassDir;
  turn: number | null;
  hand: Card[];
  handCounts: number[];
  /** quem já escolheu as cartas do passe */
  passed: boolean[];
  /** cartas que eu já escolhi passar (null = ainda não escolhi) */
  myPass: string[] | null;
  /** ids das cartas que recebi no passe (destaque na 1ª vaza) */
  received: string[];
  trick: Play[];
  trickWinner: number | null;
  lastTrick: TrickRecord | null;
  heartsBroken: boolean;
  /** pontos levados na mão por assento */
  handPoints: number[];
  /** assento que levou a dama de espadas nesta mão (null = ainda não saiu/levaram) */
  queenBy: number | null;
  scores: number[];
  endScore: number;
  /** ids jogáveis (só na minha vez, na fase de jogo) */
  legal: string[] | null;
  handResult: HandResult | null;
  result: MatchResult | null;
}

const idx = (c: Card) => RANK_ORDER.indexOf(c.r);
export const isQueenSpades = (c: Card) => c.r === 'Q' && c.s === 'S';
export const cardPoints = (c: Card) => (c.s === 'H' ? 1 : isQueenSpades(c) ? 13 : 0);
export const passDirOf = (handNo: number): PassDir => PASS_CYCLE[handNo % 4];

export function legalCards(hand: Card[], trick: Play[], tricksDone: number, heartsBroken: boolean): Card[] {
  if (trick.length === 0) {
    if (tricksDone === 0) {
      const two = hand.filter((c) => c.r === '2' && c.s === 'C');
      if (two.length > 0) return two;
      return hand;
    }
    if (!heartsBroken) {
      const nonHearts = hand.filter((c) => c.s !== 'H');
      if (nonHearts.length > 0) return nonHearts;
    }
    return hand;
  }
  const lead = trick[0].card.s;
  const follow = hand.filter((c) => c.s === lead);
  if (follow.length > 0) return follow;
  if (tricksDone === 0) {
    const safe = hand.filter((c) => cardPoints(c) === 0);
    if (safe.length > 0) return safe;
  }
  return hand;
}

export function trickWinnerOf(plays: Play[]): number {
  const lead = plays[0].card.s;
  let best = plays[0];
  for (const p of plays) if (p.card.s === lead && idx(p.card) > idx(best.card)) best = p;
  return best.seat;
}

function dealHand(s: State, ctx: EngineCtx): State {
  const deck = shuffle(deck52(), ctx.rng);
  const hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 13, i * 13 + 13), RANK_ORDER));
  const next: State = {
    ...s,
    hands,
    phase: 'passing',
    passes: [null, null, null, null],
    received: [[], [], [], []],
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    heartsBroken: false,
    handPoints: [0, 0, 0, 0],
    queenBy: null,
    lastTrick: null,
    handResult: null,
  };
  if (passDirOf(s.handNo) === 'none') return startPlay(next);
  return next;
}

function startPlay(s: State): State {
  const leader = s.hands.findIndex((h) => h.some((c) => c.r === '2' && c.s === 'C'));
  return { ...s, phase: 'playing', turn: leader, trick: [] };
}

function create(config: Record<string, number>, players: SeatPlayer[], ctx: EngineCtx): StepResult<State> {
  if (players.length !== 4) throw new Error('Copas precisa de 4 jogadores');
  const base: State = {
    players: players.map((p) => ({ ...p })),
    endScore: config.endScore ?? 100,
    turnMs: (config.turnSeconds ?? 20) * 1000,
    hands: [[], [], [], []],
    handNo: 0,
    phase: 'passing',
    passes: [null, null, null, null],
    received: [[], [], [], []],
    turn: 0,
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    heartsBroken: false,
    handPoints: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
    queenBy: null,
    lastTrick: null,
    handResult: null,
    winners: null,
  };
  return { state: dealHand(base, ctx), events: [{ type: 'deal', text: 'Cartas distribuídas.' }] };
}

function applyAction(state: State, seat: number, action: Action, _ctx: EngineCtx): StepResult<State> | EngineError {
  if (!action || typeof action !== 'object') return { error: 'Ação inválida.' };
  if (state.winners) return { error: 'A partida já terminou.' };

  if (action.type === 'pass') {
    if (state.phase !== 'passing') return { error: 'Não é hora de passar cartas.' };
    if (state.passes[seat]) return { error: 'Você já escolheu as cartas do passe.' };
    const ids = action.cardIds;
    if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) return { error: 'Escolha exatamente 3 cartas diferentes.' };
    for (const id of ids) if (!findCard(state.hands[seat], id)) return { error: 'Você não tem uma dessas cartas.' };
    const s: State = structuredClone(state);
    s.passes[seat] = ids.slice();
    if (s.passes.some((p) => p === null)) return { state: s, events: [{ type: 'passChosen', seat }] };
    // todos escolheram: troca simultânea
    const dir = passDirOf(s.handNo);
    const off = PASS_OFFSET[dir];
    const outgoing = s.passes.map((p, i) => (p as string[]).map((id) => s.hands[i].find((c) => c.id === id) as Card));
    const hands = s.hands.map((h, i) => {
      let kept = h;
      for (const c of outgoing[i]) kept = without(kept, c.id);
      return kept;
    });
    for (let i = 0; i < 4; i++) {
      const to = (i + off) % 4;
      hands[to] = hands[to].concat(outgoing[i]);
      s.received[to] = outgoing[i].map((c) => c.id);
    }
    s.hands = hands.map((h) => sortHand(h, RANK_ORDER));
    const started = startPlay(s);
    return { state: started, events: [{ type: 'passDone', text: 'Cartas trocadas.' }] };
  }

  if (action.type === 'play') {
    if (state.phase !== 'playing') return { error: 'Aguarde a próxima jogada.' };
    if (seat !== state.turn) return { error: 'Não é a sua vez.' };
    const hand = state.hands[seat];
    const card = findCard(hand, action.cardId);
    if (!card) return { error: 'Você não tem essa carta.' };
    const legal = legalCards(hand, state.trick, state.tricksDone, state.heartsBroken);
    if (!legal.some((c) => c.id === card.id)) {
      if (state.trick.length === 0 && state.tricksDone === 0) return { error: 'A primeira jogada deve ser o 2 de paus.' };
      if (state.trick.length === 0 && card.s === 'H') return { error: 'As copas ainda não foram quebradas.' };
      if (state.trick.length > 0 && card.s !== state.trick[0].card.s && hand.some((c) => c.s === state.trick[0].card.s)) {
        return { error: 'Você precisa seguir o naipe de saída.' };
      }
      return { error: 'Na primeira vaza não pode jogar copas nem a dama de espadas.' };
    }
    const s: State = structuredClone(state);
    s.hands[seat] = without(s.hands[seat], card.id);
    s.trick.push({ seat, card });
    if (card.s === 'H') s.heartsBroken = true;
    const events: GameEvent[] = [{ type: 'play', seat, data: card.id }];
    if (s.trick.length < 4) {
      s.turn = nextSeat(seat, 4);
      return { state: s, events };
    }
    const winner = trickWinnerOf(s.trick);
    const pts = s.trick.reduce((a, p) => a + cardPoints(p.card), 0);
    s.handPoints[winner] += pts;
    if (s.trick.some((p) => isQueenSpades(p.card))) s.queenBy = winner;
    s.tricksDone += 1;
    s.trickWinner = winner;
    s.phase = 'trickEnd';
    s.lastTrick = { plays: s.trick.map((p) => ({ ...p })), winner, points: pts };
    events.push({ type: 'trick', seat: winner, text: `${s.players[winner].name} levou a vaza${pts ? ` (${pts} pts)` : ''}.` });
    return { state: s, events, advanceInMs: TRICK_MS };
  }
  return { error: 'Ação inválida.' };
}

function advance(state: State, ctx: EngineCtx): StepResult<State> {
  if (state.phase === 'trickEnd') {
    const s: State = structuredClone(state);
    const winner = s.trickWinner as number;
    s.trick = [];
    s.trickWinner = null;
    if (s.tricksDone < 13) {
      s.phase = 'playing';
      s.turn = winner;
      return { state: s };
    }
    const shooter = s.handPoints.findIndex((p) => p === 26);
    const points = shooter >= 0 ? s.handPoints.map((_, i) => (i === shooter ? 0 : 26)) : s.handPoints.slice();
    s.scores = s.scores.map((v, i) => v + points[i]);
    s.handResult = { points, shooter: shooter >= 0 ? shooter : null, scores: s.scores.slice() };
    const events: GameEvent[] = [{
      type: 'handEnd',
      text: shooter >= 0 ? `${s.players[shooter].name} fechou o jogo! Os outros recebem 26.` : 'Mão encerrada.',
    }];
    if (Math.max(...s.scores) >= s.endScore) {
      const min = Math.min(...s.scores);
      s.winners = s.scores.map((v, i) => (v === min ? i : -1)).filter((i) => i >= 0);
      s.phase = 'over';
      events.push({ type: 'matchEnd', text: 'Fim da partida.' });
      return { state: s, events };
    }
    s.phase = 'handEnd';
    return { state: s, events, advanceInMs: HAND_MS };
  }
  if (state.phase === 'handEnd') {
    const s: State = { ...structuredClone(state), handNo: state.handNo + 1 };
    return { state: dealHand(s, ctx), events: [{ type: 'deal', text: 'Nova mão.' }] };
  }
  return { state };
}

function getTurn(state: State): TurnInfo {
  if (state.winners) return { seats: [], timeoutMs: state.turnMs };
  if (state.phase === 'passing') {
    return { seats: [0, 1, 2, 3].filter((i) => state.passes[i] === null), timeoutMs: state.turnMs };
  }
  return { seats: state.phase === 'playing' ? [state.turn] : [], timeoutMs: state.turnMs };
}

function getResult(state: State): MatchResult | null {
  if (!state.winners) return null;
  const names = state.winners.map((i) => state.players[i].name).join(' e ');
  const placar = state.scores.map((v, i) => `${state.players[i].name} ${v}`).join(', ');
  return { winners: state.winners.slice(), summary: `${names} venceu com a menor pontuação (${placar}).` };
}

function getView(state: State, seat: number | null): View {
  const myHand = seat === null ? [] : state.hands[seat];
  const legal = seat !== null && state.phase === 'playing' && state.turn === seat
    ? legalCards(myHand, state.trick, state.tricksDone, state.heartsBroken).map((c) => c.id) : null;
  return {
    game: 'copas',
    seat,
    players: publicPlayers(state.players),
    phase: state.phase,
    handNo: state.handNo,
    passDir: passDirOf(state.handNo),
    turn: state.phase === 'playing' ? state.turn : null,
    hand: myHand,
    handCounts: state.hands.map((h) => h.length),
    passed: state.passes.map((p) => p !== null),
    myPass: seat !== null && state.phase === 'passing' ? state.passes[seat] : null,
    received: seat !== null && state.tricksDone === 0 && state.trick.length === 0 ? state.received[seat] : [],
    trick: state.trick,
    trickWinner: state.trickWinner,
    lastTrick: state.lastTrick,
    heartsBroken: state.heartsBroken,
    handPoints: state.handPoints,
    queenBy: state.queenBy,
    scores: state.scores,
    endScore: state.endScore,
    legal,
    handResult: state.handResult,
    result: getResult(state),
  };
}

function timeoutAction(state: State, seat: number): Action {
  const hand = state.hands[seat];
  if (state.phase === 'passing') {
    const top = hand.slice().sort((a, b) => idx(b) - idx(a)).slice(0, 3);
    return { type: 'pass', cardIds: top.map((c) => c.id) };
  }
  const legal = legalCards(hand, state.trick, state.tricksDone, state.heartsBroken);
  const low = legal.reduce((a, b) => (idx(b) < idx(a) ? b : a));
  return { type: 'play', cardId: low.id };
}

function dangerToPass(c: Card): number {
  if (isQueenSpades(c)) return 100;
  if (c.s === 'S' && (c.r === 'A' || c.r === 'K')) return 80 + idx(c);
  if (c.s === 'H') return 30 + idx(c) * 2;
  return idx(c);
}

function botAction(state: State, seat: number, _ctx: EngineCtx): Action {
  const hand = state.hands[seat];
  if (state.phase === 'passing') {
    const top = hand.slice().sort((a, b) => dangerToPass(b) - dangerToPass(a)).slice(0, 3);
    return { type: 'pass', cardIds: top.map((c) => c.id) };
  }
  const legal = legalCards(hand, state.trick, state.tricksDone, state.heartsBroken);
  const pick = (c: Card): Action => ({ type: 'play', cardId: c.id });
  if (legal.length === 1) return pick(legal[0]);
  const lowest = (cs: Card[]) => cs.reduce((a, b) => (idx(b) < idx(a) ? b : a));
  const highest = (cs: Card[]) => cs.reduce((a, b) => (idx(b) > idx(a) ? b : a));

  // ---- saindo
  if (state.trick.length === 0) {
    const risk = (c: Card) => idx(c) + (c.s === 'H' ? 6 : 0) + (c.s === 'S' && idx(c) >= 10 ? 25 : 0);
    return pick(legal.reduce((a, b) => (risk(b) < risk(a) ? b : a)));
  }
  const lead = state.trick[0].card.s;
  const follows = legal[0].s === lead;
  if (!follows) {
    // descartando: dama de espadas, copas altas, depois a carta mais alta
    const qs = legal.find(isQueenSpades);
    if (qs) return pick(qs);
    const hearts = legal.filter((c) => c.s === 'H');
    if (hearts.length > 0) return pick(highest(hearts));
    const dangerousSpades = legal.filter((c) => c.s === 'S' && (c.r === 'A' || c.r === 'K'));
    if (dangerousSpades.length > 0) return pick(highest(dangerousSpades));
    return pick(highest(legal));
  }
  const bestIdx = Math.max(...state.trick.filter((p) => p.card.s === lead).map((p) => idx(p.card)));
  const lower = legal.filter((c) => idx(c) < bestIdx);
  if (lower.length > 0) {
    const qs = lower.find(isQueenSpades);
    if (qs) return pick(qs);
    return pick(highest(lower));
  }
  // vou ganhar a vaza de qualquer jeito
  const last = state.trick.length === 3;
  if (last) {
    const noQueen = legal.filter((c) => !isQueenSpades(c));
    return pick(highest(noQueen.length > 0 ? noQueen : legal));
  }
  return pick(lowest(legal));
}

function replaceWithBot(state: State, seat: number, botName: string): State {
  return { ...state, players: withBot(state.players, seat, botName) };
}

export const engine: MatchEngine<State, Action> = {
  id: 'copas',
  economy: 'match',
  create,
  applyAction,
  advance,
  getView,
  getTurn,
  getResult,
  timeoutAction,
  botAction,
  replaceWithBot,
};
