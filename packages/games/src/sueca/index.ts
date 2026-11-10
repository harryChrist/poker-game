/**
 * SUECA — 4 jogadores em duplas (time 0 = assentos 0 e 2; time 1 = assentos 1 e 3), 40 cartas.
 * Ordem: A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2. Pontos: A=11, 7=10, K=4, J=3, Q=2 (120 no total).
 */
import {
  cardLabel, deck40, shuffle,
  type Card, type EngineCtx, type EngineError, type GameEvent, type MatchEngine, type MatchResult, type MaybeCard,
  type Rank, type SeatPlayer, type StepResult, type Suit, type TurnInfo,
} from '@cards/shared';
import {
  dealRoundRobin, findCard, hiddenCards, nextSeat, publicPlayers, sortHand, withBot, without,
  type Play, type PublicPlayer,
} from '../_tricks/common';

export const RANK_ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', 'Q', 'J', 'K', '7', 'A'];
export const POINTS: Partial<Record<Rank, number>> = { A: 11, '7': 10, K: 4, J: 3, Q: 2 };
export const TRICK_MS = 1200;
export const HAND_MS = 3000;

export type Phase = 'playing' | 'trickEnd' | 'handEnd' | 'over';

export interface TrickRecord {
  plays: Play[];
  winner: number;
  points: number;
}

export interface HandResult {
  /** pontos de cada dupla na mão */
  points: [number, number];
  /** dupla que marcou jogos (null = empate 60 x 60) */
  team: 0 | 1 | null;
  /** quantos jogos marcou */
  games: number;
  text: string;
}

export interface State {
  players: SeatPlayer[];
  targetGames: number;
  turnMs: number;
  dealer: number;
  hands: Card[][];
  trump: Card;
  phase: Phase;
  turn: number;
  trick: Play[];
  trickWinner: number | null;
  /** vazas já concluídas na mão */
  tricksDone: number;
  points: [number, number];
  games: [number, number];
  handNo: number;
  lastTrick: TrickRecord | null;
  handResult: HandResult | null;
  winnerTeam: 0 | 1 | null;
}

export type Action = { type: 'play'; cardId: string };

export interface View {
  game: 'sueca';
  seat: number | null;
  myTeam: 0 | 1 | null;
  players: PublicPlayer[];
  phase: Phase;
  dealer: number;
  turn: number | null;
  /** carta do trunfo (a última dada ao distribuidor) */
  trump: Card;
  trumpSuit: Suit;
  /** assento que ainda segura a carta do trunfo (null = já foi jogada) */
  trumpHeldBy: number | null;
  hand: Card[];
  /** mão de cada assento: a minha aberta, as outras viradas */
  hands: MaybeCard[][];
  trick: Play[];
  trickWinner: number | null;
  lastTrick: TrickRecord | null;
  /** ids das cartas jogáveis (só na minha vez) */
  legal: string[] | null;
  /** pontos da mão por dupla */
  points: [number, number];
  /** jogos por dupla */
  games: [number, number];
  targetGames: number;
  handNo: number;
  handResult: HandResult | null;
  result: MatchResult | null;
}

export const teamOf = (seat: number): 0 | 1 => (seat % 2) as 0 | 1;
const cardPoints = (c: Card) => POINTS[c.r] ?? 0;
const rankIdx = (c: Card) => RANK_ORDER.indexOf(c.r);

/** Força da carta na vaza: trunfo > naipe de saída > nada */
export function strength(c: Card, trumpSuit: Suit, leadSuit: Suit): number {
  if (c.s === trumpSuit) return 100 + rankIdx(c);
  if (c.s === leadSuit) return rankIdx(c);
  return -1;
}

export function trickWinnerOf(plays: Play[], trumpSuit: Suit): number {
  const lead = plays[0].card.s;
  let best = plays[0];
  for (const p of plays) if (strength(p.card, trumpSuit, lead) > strength(best.card, trumpSuit, lead)) best = p;
  return best.seat;
}

export function legalCards(hand: Card[], trick: Play[]): Card[] {
  if (trick.length === 0) return hand;
  const lead = trick[0].card.s;
  const follow = hand.filter((c) => c.s === lead);
  return follow.length > 0 ? follow : hand;
}

/** Resultado de uma mão pela pontuação (61–90 = 1; 91–119 = 2; 120 = 4; 60x60 = nada) */
export function scoreHand(points: [number, number]): HandResult {
  const [a, b] = points;
  if (a === b) return { points, team: null, games: 0, text: `Empate em ${a} x ${b}: ninguém marca jogo.` };
  const team: 0 | 1 = a > b ? 0 : 1;
  const win = Math.max(a, b);
  const games = win === 120 ? 4 : win >= 91 ? 2 : 1;
  return {
    points, team, games,
    text: `${win} x ${Math.min(a, b)}: a dupla ${team === 0 ? 'A' : 'B'} marca ${games} ${games === 1 ? 'jogo' : 'jogos'}.`,
  };
}

function dealHand(s: State, ctx: EngineCtx): State {
  const deck = shuffle(deck40(), ctx.rng);
  const first = nextSeat(s.dealer, 4);
  const hands = dealRoundRobin(deck, 4, 10, first); // o distribuidor recebe a última carta
  const trump = deck[39];
  return {
    ...s,
    hands: hands.map((h) => sortHand(h, RANK_ORDER)),
    trump,
    phase: 'playing',
    turn: first,
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    points: [0, 0],
    lastTrick: null,
    handResult: null,
    handNo: s.handNo + 1,
  };
}

function teamNames(s: State, t: 0 | 1): string {
  const seats = t === 0 ? [0, 2] : [1, 3];
  return seats.map((i) => s.players[i].name).join(' e ');
}

/** Eventos públicos do início da mão: separador e trunfo (a carta do distribuidor é mostrada a todos). */
function handStartEvents(s: State): GameEvent[] {
  return [
    { type: 'hand_start', text: `Mão #${s.handNo}` },
    {
      type: 'trump', seat: s.dealer, text: `Trunfo: ${cardLabel(s.trump)} (carta de ${s.players[s.dealer].name}, o distribuidor)`,
      data: { cards: [s.trump] },
    },
  ];
}

function create(config: Record<string, number>, players: SeatPlayer[], ctx: EngineCtx): StepResult<State> {
  if (players.length !== 4) throw new Error('A sueca precisa de 4 jogadores');
  const base: State = {
    players: players.map((p) => ({ ...p })),
    targetGames: config.targetGames ?? 4,
    turnMs: (config.turnSeconds ?? 20) * 1000,
    dealer: Math.floor(ctx.rng() * 4),
    hands: [[], [], [], []],
    trump: deck40()[0],
    phase: 'playing',
    turn: 0,
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    points: [0, 0],
    games: [0, 0],
    handNo: 0,
    lastTrick: null,
    handResult: null,
    winnerTeam: null,
  };
  const state = dealHand(base, ctx);
  return { state, events: handStartEvents(state) };
}

function applyAction(state: State, seat: number, action: Action, _ctx: EngineCtx): StepResult<State> | EngineError {
  if (!action || (action as Action).type !== 'play') return { error: 'Ação inválida.' };
  if (state.winnerTeam !== null) return { error: 'A partida já terminou.' };
  if (state.phase !== 'playing') return { error: 'Aguarde a próxima jogada.' };
  if (seat !== state.turn) return { error: 'Não é a sua vez.' };
  const hand = state.hands[seat];
  const card = findCard(hand, action.cardId);
  if (!card) return { error: 'Você não tem essa carta.' };
  const legal = legalCards(hand, state.trick);
  if (!legal.some((c) => c.id === card.id)) return { error: 'Você precisa seguir o naipe de saída.' };

  const s: State = structuredClone(state);
  s.hands[seat] = without(s.hands[seat], card.id);
  s.trick.push({ seat, card });
  const events: GameEvent[] = [{
    type: 'play', seat, text: `${s.players[seat].name} jogou ${cardLabel(card)}`, data: { cards: [card] },
  }];
  if (s.trick.length < 4) {
    s.turn = nextSeat(seat, 4);
    return { state: s, events };
  }
  const winner = trickWinnerOf(s.trick, s.trump.s);
  const pts = s.trick.reduce((a, p) => a + cardPoints(p.card), 0);
  s.points[teamOf(winner)] += pts;
  s.tricksDone += 1;
  s.trickWinner = winner;
  s.phase = 'trickEnd';
  s.lastTrick = { plays: s.trick.map((p) => ({ ...p })), winner, points: pts };
  events.push({ type: 'trick', seat: winner, text: `${s.players[winner].name} levou a vaza (+${pts})`, data: { points: pts } });
  return { state: s, events, advanceInMs: TRICK_MS };
}

function advance(state: State, ctx: EngineCtx): StepResult<State> {
  if (state.phase === 'trickEnd') {
    const s: State = structuredClone(state);
    const winner = s.trickWinner as number;
    s.trick = [];
    s.trickWinner = null;
    if (s.tricksDone < 10) {
      s.phase = 'playing';
      s.turn = winner;
      return { state: s };
    }
    const res = scoreHand(s.points);
    s.handResult = res;
    if (res.team !== null) s.games[res.team] += res.games;
    const events: GameEvent[] = [{
      type: 'handEnd', text: `Fim da mão. ${res.text} Jogos: ${s.games[0]} x ${s.games[1]}`, data: { points: res.points },
    }];
    const t = s.games[0] >= s.targetGames ? 0 : s.games[1] >= s.targetGames ? 1 : null;
    if (t !== null) {
      s.winnerTeam = t;
      s.phase = 'over';
      events.push({ type: 'matchEnd', text: `Dupla ${teamNames(s, t)} venceu a partida.` });
      return { state: s, events };
    }
    s.phase = 'handEnd';
    return { state: s, events, advanceInMs: HAND_MS };
  }
  if (state.phase === 'handEnd') {
    const s: State = { ...structuredClone(state), dealer: nextSeat(state.dealer, 4) };
    const next = dealHand(s, ctx);
    return { state: next, events: handStartEvents(next) };
  }
  return { state };
}

function getTurn(state: State): TurnInfo {
  return { seats: state.phase === 'playing' ? [state.turn] : [], timeoutMs: state.turnMs };
}

function getResult(state: State): MatchResult | null {
  if (state.winnerTeam === null) return null;
  const t = state.winnerTeam;
  const seats = t === 0 ? [0, 2] : [1, 3];
  return {
    winners: seats,
    summary: `Dupla de ${teamNames(state, t)} venceu por ${state.games[t]} x ${state.games[1 - t]} jogos.`,
  };
}

function getView(state: State, seat: number | null): View {
  const myHand = seat === null ? [] : state.hands[seat];
  const legal = seat !== null && state.phase === 'playing' && state.turn === seat
    ? legalCards(myHand, state.trick).map((c) => c.id) : null;
  const heldBy = state.hands.findIndex((h) => h.some((c) => c.id === state.trump.id));
  return {
    game: 'sueca',
    seat,
    myTeam: seat === null ? null : teamOf(seat),
    players: publicPlayers(state.players),
    phase: state.phase,
    dealer: state.dealer,
    turn: state.phase === 'playing' ? state.turn : null,
    trump: state.trump,
    trumpSuit: state.trump.s,
    trumpHeldBy: heldBy >= 0 ? heldBy : null,
    hand: myHand,
    hands: state.hands.map((h, i) => (i === seat ? h : hiddenCards(h.length))),
    trick: state.trick,
    trickWinner: state.trickWinner,
    lastTrick: state.lastTrick,
    legal,
    points: state.points,
    games: state.games,
    targetGames: state.targetGames,
    handNo: state.handNo,
    handResult: state.handResult,
    result: getResult(state),
  };
}

/** Menor carta jogável (preferindo não gastar trunfo) */
function lowestLegal(state: State, seat: number): Card {
  const trumpSuit = state.trump.s;
  const legal = legalCards(state.hands[seat], state.trick);
  const cost = (c: Card) => (c.s === trumpSuit ? 100 : 0) + rankIdx(c);
  return legal.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

function timeoutAction(state: State, seat: number): Action {
  return { type: 'play', cardId: lowestLegal(state, seat).id };
}

function botAction(state: State, seat: number, _ctx: EngineCtx): Action {
  const hand = state.hands[seat];
  const trumpSuit = state.trump.s;
  const legal = legalCards(hand, state.trick);
  if (legal.length === 1) return { type: 'play', cardId: legal[0].id };
  const isTrump = (c: Card) => c.s === trumpSuit;
  const cheapest = (cs: Card[]) => cs.reduce((a, b) => {
    const ka = (isTrump(a) ? 100 : 0) + cardPoints(a) * 0.01 + rankIdx(a);
    const kb = (isTrump(b) ? 100 : 0) + cardPoints(b) * 0.01 + rankIdx(b);
    return kb < ka ? b : a;
  });
  const pick = (c: Card): Action => ({ type: 'play', cardId: c.id });

  // ---- saindo
  if (state.trick.length === 0) {
    const trumps = hand.filter(isTrump);
    const strongTrumps = trumps.length >= 4 || (trumps.length >= 3 && trumps.some((c) => c.r === 'A' || c.r === '7'));
    if (strongTrumps) return pick(trumps.reduce((a, b) => (rankIdx(b) > rankIdx(a) ? b : a)));
    const nonTrump = hand.filter((c) => !isTrump(c));
    const aces = nonTrump.filter((c) => c.r === 'A');
    if (aces.length > 0) return pick(aces[0]);
    if (nonTrump.length > 0) return pick(cheapest(nonTrump));
    return pick(cheapest(hand));
  }

  // ---- respondendo
  const lead = state.trick[0].card.s;
  const best = state.trick.reduce((a, b) => (strength(b.card, trumpSuit, lead) > strength(a.card, trumpSuit, lead) ? b : a));
  const bestStrength = strength(best.card, trumpSuit, lead);
  const partnerWinning = teamOf(best.seat) === teamOf(seat);
  const last = state.trick.length === 3;
  const trickPts = state.trick.reduce((a, p) => a + cardPoints(p.card), 0);
  const richest = (cs: Card[]) => cs.reduce((a, b) => (
    cardPoints(b) > cardPoints(a) || (cardPoints(b) === cardPoints(a) && rankIdx(b) < rankIdx(a)) ? b : a
  ));

  if (partnerWinning) {
    const safe = last || isTrump(best.card) || best.card.r === 'A' || best.card.r === '7';
    if (safe) {
      const noTrump = legal.filter((c) => !isTrump(c));
      const pool = noTrump.length > 0 ? noTrump : legal;
      return pick(richest(pool));
    }
    return pick(cheapest(legal));
  }
  const winners = legal.filter((c) => strength(c, trumpSuit, lead) > bestStrength);
  if (winners.length > 0) {
    const cheapestWinner = winners.reduce((a, b) => (strength(b, trumpSuit, lead) < strength(a, trumpSuit, lead) ? b : a));
    const wasteful = isTrump(cheapestWinner) && trickPts === 0 && !last;
    if (!wasteful) return pick(cheapestWinner);
  }
  return pick(cheapest(legal));
}

function replaceWithBot(state: State, seat: number, botName: string): State {
  return { ...state, players: withBot(state.players, seat, botName) };
}

export const engine: MatchEngine<State, Action> = {
  id: 'sueca',
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
