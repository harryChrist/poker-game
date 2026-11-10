/**
 * FODINHA — 2 a 8 jogadores, baralho de 40 cartas.
 * Força (truco paulista): 4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3; a vira define a manilha (próxima na ordem);
 * manilhas por naipe: ouros < espadas < copas < paus. Cartas iguais não-manilha se anulam ("embuchou").
 */
import {
  deck40, shuffle,
  type Card, type EngineCtx, type EngineError, type GameEvent, type MatchEngine, type MatchResult, type MaybeCard,
  type Rank, type SeatPlayer, type StepResult, type Suit, type TurnInfo,
} from '@cards/shared';
import { hiddenCards, publicPlayers, withBot, without, type Play, type PublicPlayer } from '../_tricks/common';

export const ORDER: readonly Rank[] = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
const SUIT_RANK: Record<Suit, number> = { D: 0, S: 1, H: 2, C: 3 };
export const TRICK_MS = 1200;
export const ROUND_MS = 3000;

export type Phase = 'betting' | 'playing' | 'trickEnd' | 'roundEnd' | 'over';

export interface RoundRow {
  seat: number;
  bet: number;
  won: number;
  lost: number;
  livesBefore: number;
  livesAfter: number;
}

export interface TrickRecord {
  plays: Play[];
  /** null = embuchou (todas as cartas se anularam) */
  winner: number | null;
}

export interface State {
  players: SeatPlayer[];
  turnMs: number;
  lives: number[];
  /** nº da rodada (1, 2, ...) */
  round: number;
  cardsPer: number;
  dir: 1 | -1;
  dealer: number;
  phase: Phase;
  hands: Card[][];
  vira: Card;
  bets: (number | null)[];
  won: number[];
  betOrder: number[];
  turn: number;
  leader: number;
  trick: Play[];
  trickWinner: number | null;
  tricksDone: number;
  lastTrick: TrickRecord | null;
  roundResult: RoundRow[] | null;
  winners: number[] | null;
}

export type Action =
  | { type: 'bet'; n: number }
  /** cardId pode ser omitido quando só resta uma carta (rodada de 1 carta, em que você não vê a sua) */
  | { type: 'play'; cardId?: string };

export interface View {
  game: 'fodinha';
  seat: number | null;
  players: PublicPlayer[];
  phase: Phase;
  round: number;
  cardsPer: number;
  dealer: number;
  turn: number | null;
  lives: number[];
  alive: boolean[];
  vira: Card;
  manilhaRank: Rank;
  /** rodada de 1 carta: vejo a dos outros, não a minha */
  oneCard: boolean;
  /** mão de cada assento como eu enxergo (a minha aberta, exceto na rodada de 1 carta) */
  hands: MaybeCard[][];
  myHand: MaybeCard[];
  bets: (number | null)[];
  won: number[];
  betOrder: number[];
  /** minha vez de apostar: opções e o número proibido (só para o "pé") */
  bet: { options: number[]; forbidden: number | null } | null;
  /** minha vez de jogar (qualquer carta vale; na rodada de 1 carta mande a ação sem cardId) */
  canPlay: boolean;
  trick: Play[];
  trickWinner: number | null;
  /** vaza encerrada em que todas as cartas se anularam */
  embuchou: boolean;
  lastTrick: TrickRecord | null;
  roundResult: RoundRow[] | null;
  result: MatchResult | null;
}

export function manilhaRankOf(vira: Card): Rank {
  return ORDER[(ORDER.indexOf(vira.r) + 1) % ORDER.length];
}

export function cardStrength(c: Card, manilha: Rank): number {
  return c.r === manilha ? 100 + SUIT_RANK[c.s] : ORDER.indexOf(c.r);
}

/** Vencedor da vaza (null = todas anuladas) */
export function trickWinnerOf(plays: Play[], manilha: Rank): number | null {
  const strengths = plays.map((p) => cardStrength(p.card, manilha));
  let best: number | null = null;
  let bestS = -1;
  plays.forEach((p, i) => {
    const s = strengths[i];
    if (strengths.filter((x) => x === s).length > 1) return; // embuchou
    if (s > bestS) { bestS = s; best = p.seat; }
  });
  return best;
}

/** Próximo nº de cartas no ciclo 1..max..1..max */
export function nextCardCount(cur: number, dir: 1 | -1, max: number): { n: number; dir: 1 | -1 } {
  let d = dir;
  let n = cur + d;
  if (n > max) { d = -1; n = cur - 1; }
  if (n < 1) { d = 1; n = cur + 1; }
  n = Math.min(Math.max(n, 1), max);
  return { n, dir: d };
}

export const maxCards = (alive: number) => Math.floor(39 / alive);

const aliveSeats = (s: State) => s.lives.map((l, i) => (l > 0 ? i : -1)).filter((i) => i >= 0);

function nextAlive(s: Pick<State, 'lives'>, seat: number): number {
  const n = s.lives.length;
  for (let k = 1; k <= n; k++) {
    const j = (seat + k) % n;
    if (s.lives[j] > 0) return j;
  }
  return seat;
}

function dealRound(s: State, ctx: EngineCtx): State {
  const n = s.players.length;
  const deck = shuffle(deck40(), ctx.rng);
  const order: number[] = [];
  let p = s.dealer;
  for (let k = 0; k < aliveSeats(s).length; k++) { p = nextAlive(s, p); order.push(p); }
  // order termina no próprio distribuidor (o "pé")
  const vira = deck[s.cardsPer * order.length];
  const manilha = manilhaRankOf(vira);
  const hands: Card[][] = Array.from({ length: n }, () => []);
  let k = 0;
  for (let i = 0; i < s.cardsPer; i++) for (const seat of order) hands[seat].push(deck[k++]);
  for (const seat of order) hands[seat].sort((a, b) => cardStrength(a, manilha) - cardStrength(b, manilha));
  return {
    ...s,
    phase: 'betting',
    hands,
    vira,
    bets: Array(n).fill(null),
    won: Array(n).fill(0),
    betOrder: order,
    turn: order[0],
    leader: order[0],
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    lastTrick: null,
    roundResult: null,
  };
}

function create(config: Record<string, number>, players: SeatPlayer[], ctx: EngineCtx): StepResult<State> {
  const n = players.length;
  if (n < 2 || n > 8) throw new Error('A fodinha é para 2 a 8 jogadores');
  const base: State = {
    players: players.map((p) => ({ ...p })),
    turnMs: (config.turnSeconds ?? 20) * 1000,
    lives: Array(n).fill(config.lives ?? 5),
    round: 1,
    cardsPer: 1,
    dir: 1,
    dealer: Math.floor(ctx.rng() * n),
    phase: 'betting',
    hands: Array.from({ length: n }, () => []),
    vira: deck40()[0],
    bets: Array(n).fill(null),
    won: Array(n).fill(0),
    betOrder: [],
    turn: 0,
    leader: 0,
    trick: [],
    trickWinner: null,
    tricksDone: 0,
    lastTrick: null,
    roundResult: null,
    winners: null,
  };
  return { state: dealRound(base, ctx), events: [{ type: 'deal', text: 'Rodada de 1 carta.' }] };
}

/** Soma dos palpites já feitos e se o assento é o último a apostar */
function betContext(s: State, seat: number) {
  const placed = s.betOrder.filter((i) => s.bets[i] !== null);
  const sum = placed.reduce((a, i) => a + (s.bets[i] as number), 0);
  const isLast = placed.length === s.betOrder.length - 1;
  const forbidden = isLast && seat === s.turn ? s.cardsPer - sum : null;
  return { sum, isLast, forbidden: forbidden !== null && forbidden >= 0 && forbidden <= s.cardsPer ? forbidden : null };
}

function applyAction(state: State, seat: number, action: Action, _ctx: EngineCtx): StepResult<State> | EngineError {
  if (!action || typeof action !== 'object') return { error: 'Ação inválida.' };
  if (state.winners) return { error: 'A partida já terminou.' };

  if (action.type === 'bet') {
    if (state.phase !== 'betting') return { error: 'Não é hora de apostar.' };
    if (seat !== state.turn) return { error: 'Não é a sua vez.' };
    const n = action.n;
    if (!Number.isInteger(n) || n < 0 || n > state.cardsPer) return { error: `O palpite deve ir de 0 a ${state.cardsPer}.` };
    const ctxB = betContext(state, seat);
    if (ctxB.forbidden === n) return { error: `Você não pode apostar ${n}: a soma dos palpites não pode ser igual a ${state.cardsPer}.` };
    const s: State = structuredClone(state);
    s.bets[seat] = n;
    const events: GameEvent[] = [{ type: 'bet', seat, data: n, text: `${s.players[seat].name} apostou ${n}.` }];
    if (s.betOrder.every((i) => s.bets[i] !== null)) {
      s.phase = 'playing';
      s.turn = s.leader;
    } else {
      s.turn = nextAlive(s, seat);
    }
    return { state: s, events };
  }

  if (action.type === 'play') {
    if (state.phase !== 'playing') return { error: 'Aguarde a próxima jogada.' };
    if (seat !== state.turn) return { error: 'Não é a sua vez.' };
    const hand = state.hands[seat];
    let card: Card | undefined;
    if (action.cardId === undefined || action.cardId === null) {
      if (hand.length !== 1) return { error: 'Escolha uma carta.' };
      card = hand[0];
    } else {
      card = hand.find((c) => c.id === action.cardId);
    }
    if (!card) return { error: 'Você não tem essa carta.' };
    const s: State = structuredClone(state);
    s.hands[seat] = without(s.hands[seat], card.id);
    s.trick.push({ seat, card });
    const events: GameEvent[] = [{ type: 'play', seat, data: card.id }];
    const alive = aliveSeats(s).length;
    if (s.trick.length < alive) {
      s.turn = nextAlive(s, seat);
      return { state: s, events };
    }
    const winner = trickWinnerOf(s.trick, manilhaRankOf(s.vira));
    if (winner !== null) s.won[winner] += 1;
    s.tricksDone += 1;
    s.trickWinner = winner;
    s.phase = 'trickEnd';
    s.lastTrick = { plays: s.trick.map((p) => ({ ...p })), winner };
    events.push({
      type: 'trick', seat: winner ?? undefined,
      text: winner === null ? 'Embuchou! Ninguém levou a vaza.' : `${s.players[winner].name} levou a vaza.`,
    });
    return { state: s, events, advanceInMs: TRICK_MS };
  }
  return { error: 'Ação inválida.' };
}

function finishRound(s: State): { state: State; events: GameEvent[]; advanceInMs?: number } {
  const rows: RoundRow[] = s.betOrder.map((seat) => {
    const bet = s.bets[seat] as number;
    const lost = Math.abs(bet - s.won[seat]);
    const before = s.lives[seat];
    return { seat, bet, won: s.won[seat], lost, livesBefore: before, livesAfter: Math.max(0, before - lost) };
  });
  for (const r of rows) s.lives[r.seat] = r.livesAfter;
  s.roundResult = rows;
  const survivors = aliveSeats(s);
  const events: GameEvent[] = [{ type: 'roundEnd', text: 'Fim da rodada.' }];
  for (const r of rows) if (r.livesBefore > 0 && r.livesAfter === 0) events.push({ type: 'out', seat: r.seat, text: `${s.players[r.seat].name} foi eliminado.` });
  if (survivors.length <= 1) {
    if (survivors.length === 1) s.winners = survivors;
    else {
      const top = Math.max(...rows.map((r) => r.livesBefore));
      s.winners = rows.filter((r) => r.livesBefore === top).map((r) => r.seat);
    }
    s.phase = 'over';
    events.push({ type: 'matchEnd', text: 'Fim da partida.' });
    return { state: s, events };
  }
  s.phase = 'roundEnd';
  return { state: s, events, advanceInMs: ROUND_MS };
}

function advance(state: State, ctx: EngineCtx): StepResult<State> {
  if (state.phase === 'trickEnd') {
    const s: State = structuredClone(state);
    const winner = s.trickWinner;
    s.trick = [];
    s.trickWinner = null;
    if (s.tricksDone < s.cardsPer) {
      s.phase = 'playing';
      s.leader = winner ?? s.leader;
      s.turn = s.leader;
      return { state: s };
    }
    return finishRound(s);
  }
  if (state.phase === 'roundEnd') {
    const s: State = structuredClone(state);
    s.dealer = nextAlive(s, s.dealer);
    s.round += 1;
    const nx = nextCardCount(s.cardsPer, s.dir, maxCards(aliveSeats(s).length));
    s.cardsPer = nx.n;
    s.dir = nx.dir;
    return { state: dealRound(s, ctx), events: [{ type: 'deal', text: `Rodada de ${s.cardsPer} ${s.cardsPer === 1 ? 'carta' : 'cartas'}.` }] };
  }
  return { state };
}

function getTurn(state: State): TurnInfo {
  const active = !state.winners && (state.phase === 'betting' || state.phase === 'playing');
  return { seats: active ? [state.turn] : [], timeoutMs: state.turnMs };
}

function getResult(state: State): MatchResult | null {
  if (!state.winners) return null;
  const names = state.winners.map((i) => state.players[i].name).join(' e ');
  const alone = state.winners.length === 1;
  return {
    winners: state.winners.slice(),
    summary: alone ? `${names} foi o último sobrevivente.` : `${names} venceram (empate nas vidas).`,
  };
}

function getView(state: State, seat: number | null): View {
  const oneCard = state.cardsPer === 1;
  const inRound = state.phase === 'betting' || state.phase === 'playing' || state.phase === 'trickEnd';
  const hands: MaybeCard[][] = state.hands.map((h, j) => {
    if (seat === null) return hiddenCards(h.length);
    if (oneCard && inRound) return j === seat ? hiddenCards(h.length) : h;
    return j === seat ? h : hiddenCards(h.length);
  });
  let bet: View['bet'] = null;
  if (seat !== null && state.phase === 'betting' && state.turn === seat) {
    const { forbidden } = betContext(state, seat);
    const options = Array.from({ length: state.cardsPer + 1 }, (_, i) => i).filter((i) => i !== forbidden);
    bet = { options, forbidden };
  }
  return {
    game: 'fodinha',
    seat,
    players: publicPlayers(state.players),
    phase: state.phase,
    round: state.round,
    cardsPer: state.cardsPer,
    dealer: state.dealer,
    turn: state.phase === 'betting' || state.phase === 'playing' ? state.turn : null,
    lives: state.lives,
    alive: state.lives.map((l) => l > 0),
    vira: state.vira,
    manilhaRank: manilhaRankOf(state.vira),
    oneCard,
    hands,
    myHand: seat === null ? [] : hands[seat],
    bets: state.bets,
    won: state.won,
    betOrder: state.betOrder,
    bet,
    canPlay: seat !== null && state.phase === 'playing' && state.turn === seat,
    trick: state.trick,
    trickWinner: state.trickWinner,
    embuchou: state.phase === 'trickEnd' && state.trickWinner === null,
    lastTrick: state.lastTrick,
    roundResult: state.roundResult,
    result: getResult(state),
  };
}

function timeoutAction(state: State, seat: number): Action {
  if (state.phase === 'betting') {
    const { forbidden } = betContext(state, seat);
    return { type: 'bet', n: forbidden === 0 ? 1 : 0 };
  }
  const manilha = manilhaRankOf(state.vira);
  const hand = state.hands[seat];
  const low = hand.reduce((a, b) => (cardStrength(b, manilha) < cardStrength(a, manilha) ? b : a));
  return { type: 'play', cardId: low.id };
}

/** Palpite do bot: usa só o que o jogador enxerga (na rodada de 1 carta, as cartas dos outros) */
function botBet(state: State, seat: number): number {
  const manilha = manilhaRankOf(state.vira);
  const aliveN = state.betOrder.length;
  const seen = new Set<string>([state.vira.id]);
  let est = 0;
  if (state.cardsPer === 1) {
    const others: Play[] = [];
    for (const j of state.betOrder) if (j !== seat) { others.push({ seat: j, card: state.hands[j][0] }); seen.add(state.hands[j][0].id); }
    const unseen = deck40().filter((c) => !seen.has(c.id));
    const wins = unseen.filter((c) => trickWinnerOf([...others, { seat, card: c }], manilha) === seat).length;
    est = wins / unseen.length;
  } else {
    for (const c of state.hands[seat]) seen.add(c.id);
    const unseen = deck40().filter((c) => !seen.has(c.id));
    for (const c of state.hands[seat]) {
      const s = cardStrength(c, manilha);
      const lower = unseen.filter((u) => cardStrength(u, manilha) < s).length;
      est += Math.pow(lower / unseen.length, aliveN - 1);
    }
  }
  let bet = Math.min(state.cardsPer, Math.max(0, Math.round(est)));
  const { forbidden } = betContext(state, seat);
  if (forbidden === bet) {
    const up = bet + 1 <= state.cardsPer ? bet + 1 : null;
    const down = bet - 1 >= 0 ? bet - 1 : null;
    if (up === null) bet = down as number;
    else if (down === null) bet = up;
    else bet = est >= bet ? up : down;
  }
  return bet;
}

function botAction(state: State, seat: number, _ctx: EngineCtx): Action {
  if (state.phase === 'betting') return { type: 'bet', n: botBet(state, seat) };
  const hand = state.hands[seat];
  if (hand.length === 1) return { type: 'play' };
  const manilha = manilhaRankOf(state.vira);
  const str = (c: Card) => cardStrength(c, manilha);
  const needed = (state.bets[seat] as number) - state.won[seat];
  const plays = state.trick;
  const wins = (c: Card) => trickWinnerOf([...plays, { seat, card: c }], manilha) === seat;
  const lowest = (cs: Card[]) => cs.reduce((a, b) => (str(b) < str(a) ? b : a));
  const highest = (cs: Card[]) => cs.reduce((a, b) => (str(b) > str(a) ? b : a));
  const pick = (c: Card): Action => ({ type: 'play', cardId: c.id });

  if (needed <= 0) {
    if (plays.length === 0) return pick(lowest(hand));
    const safe = hand.filter((c) => !wins(c));
    return pick(safe.length > 0 ? highest(safe) : lowest(hand));
  }
  if (plays.length === 0) return pick(highest(hand));
  const winners = hand.filter(wins);
  if (winners.length > 0) return pick(lowest(winners));
  return pick(lowest(hand));
}

function replaceWithBot(state: State, seat: number, botName: string): State {
  return { ...state, players: withBot(state.players, seat, botName) };
}

export const engine: MatchEngine<State, Action> = {
  id: 'fodinha',
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
