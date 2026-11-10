import {
  cardLabel, deck40, shuffle,
  type EngineCtx, type EngineError, type GameEvent, type MatchEngine, type MatchResult, type SeatPlayer, type StepResult,
} from '@cards/shared';
import type { Action, BiscaState, BiscaView, Team } from './types';
import { botAction as bot, timeoutAction as timeout } from './bot';
import { canSwapTrump, cardPoints, teamOf, trickWinner } from './rules';

export const TRICK_PAUSE_MS = 1200;
export const GAME_PAUSE_MS = 3000;

const err = (error: string): EngineError => ({ error });

function teamName(s: BiscaState, team: Team): string {
  return s.n === 2 ? s.players[team].name : `Dupla ${team === 0 ? 'A' : 'B'}`;
}

/** Eventos públicos do início do jogo: separador e trunfo (a carta virada no fundo do monte é pública). */
function gameStartEvents(s: BiscaState): GameEvent[] {
  const trump = s.stock[s.stock.length - 1];
  return [
    { type: 'hand_start', text: `Jogo #${s.gameNo}` },
    { type: 'trump', text: `Trunfo: ${cardLabel(trump)}`, data: { cards: [trump] } },
  ];
}

export function startGame(s: BiscaState, rng: () => number): void {
  const deck = shuffle(deck40(), rng);
  s.hands = Array.from({ length: s.n }, (_, i) => deck.slice(i * 3, i * 3 + 3));
  s.stock = deck.slice(s.n * 3); // a última carta é o trunfo (comprada por último)
  s.trumpSuit = s.stock[s.stock.length - 1].s;
  s.table = [];
  s.points = [0, 0];
  s.lastTrick = null;
  s.nextLeader = null;
  s.gameResult = null;
  s.pause = null;
  s.leader = (s.firstSeat + s.gameNo - 1) % s.n;
  s.turnSeat = s.leader;
  s.phase = 'play';
}

function finishGame(s: BiscaState, events: GameEvent[]): StepResult<BiscaState> {
  const [a, b] = s.points;
  let winnerTeam: Team | null = null;
  let text: string;
  if (a > 60) winnerTeam = 0;
  else if (b > 60) winnerTeam = 1;
  if (winnerTeam === null) {
    text = `Empate em ${a} a ${b}. O jogo não conta.`;
  } else {
    s.wins[winnerTeam] += 1;
    text = `${teamName(s, winnerTeam)} fez ${s.points[winnerTeam]} a ${s.points[1 - winnerTeam]}`;
  }
  s.gameResult = { winnerTeam, points: [a, b], text };
  s.turnSeat = null;
  const tally = s.targetWins > 1 ? ` (jogos: ${s.wins[0]} x ${s.wins[1]})` : '';
  events.push({ type: 'gameEnd', text: `${text}${tally}`, data: { points: [a, b] } });
  if (s.wins[0] >= s.targetWins || s.wins[1] >= s.targetWins) {
    s.phase = 'over';
    s.pause = null;
    s.winnerTeam = s.wins[0] >= s.targetWins ? 0 : 1;
    events.push({ type: 'matchEnd', text: `${teamName(s, s.winnerTeam)} venceu a partida` });
    return { state: s, events };
  }
  s.phase = 'pause';
  s.pause = 'game';
  return { state: s, events, advanceInMs: GAME_PAUSE_MS };
}

function doSwap(s: BiscaState, seat: number): StepResult<BiscaState> | EngineError {
  if (s.phase !== 'play' || s.turnSeat !== seat) return err('Não é a sua vez.');
  const two = canSwapTrump(s.hands[seat], s.stock.length, s.trumpSuit);
  if (!two) return err('Você não pode trocar o trunfo agora.');
  const idx = s.hands[seat].findIndex((c) => c.id === two.id);
  const trumpCard = s.stock[s.stock.length - 1];
  s.hands[seat][idx] = trumpCard;
  s.stock[s.stock.length - 1] = two;
  return {
    state: s,
    events: [{
      type: 'swap', seat,
      text: `${s.players[seat].name} trocou o ${cardLabel(two)} pelo trunfo (${cardLabel(trumpCard)}). Agora o trunfo virado é ${cardLabel(two)}`,
      data: { cards: [two, trumpCard] },
    }],
  };
}

function doPlay(s: BiscaState, seat: number, cardId: unknown): StepResult<BiscaState> | EngineError {
  if (s.phase !== 'play' || s.turnSeat !== seat) return err('Não é a sua vez.');
  if (typeof cardId !== 'string') return err('Carta inválida.');
  const idx = s.hands[seat].findIndex((c) => c.id === cardId);
  if (idx < 0) return err('Você não tem essa carta.');
  const [card] = s.hands[seat].splice(idx, 1);
  s.table.push({ seat, card });
  const events: GameEvent[] = [{ type: 'play', seat, text: `${s.players[seat].name} jogou ${cardLabel(card)}` }];
  if (s.table.length < s.n) {
    s.turnSeat = (seat + 1) % s.n;
    return { state: s, events };
  }
  const win = trickWinner(s.table, s.trumpSuit);
  const pts = s.table.reduce((sum, p) => sum + cardPoints(p.card), 0);
  s.points[teamOf(win.seat, s.n)] += pts;
  s.lastTrick = { winnerSeat: win.seat, points: pts, plays: s.table.map((p) => ({ ...p })) };
  s.nextLeader = win.seat;
  s.turnSeat = null;
  s.phase = 'pause';
  s.pause = 'trick';
  events.push({ type: 'trick', seat: win.seat, text: `${s.players[win.seat].name} levou a vaza (+${pts})`, data: { points: pts } });
  return { state: s, events, advanceInMs: TRICK_PAUSE_MS };
}

function getView(s: BiscaState, seat: number | null): BiscaView {
  const phase: BiscaView['phase'] = s.phase === 'pause' ? (s.pause === 'game' ? 'gameEnd' : 'trickEnd') : s.phase;
  let legal: BiscaView['legal'] = null;
  if (seat !== null && s.phase === 'play' && s.turnSeat === seat) {
    legal = {
      cards: s.hands[seat].map((c) => c.id),
      canSwap: canSwapTrump(s.hands[seat], s.stock.length, s.trumpSuit) !== null,
    };
  }
  return {
    n: s.n,
    mySeat: seat,
    myTeam: seat === null ? 0 : teamOf(seat, s.n),
    players: s.players.map((p) => ({ name: p.name, isBot: p.isBot })),
    phase,
    trumpSuit: s.trumpSuit,
    trumpCard: s.stock.length > 0 ? s.stock[s.stock.length - 1] : null,
    stockCount: s.stock.length,
    myHand: seat === null ? [] : s.hands[seat].slice(),
    handCounts: s.hands.map((h) => h.length),
    table: s.table.map((p) => ({ ...p })),
    leader: s.leader,
    turnSeat: s.turnSeat,
    points: [s.points[0], s.points[1]],
    wins: [s.wins[0], s.wins[1]],
    targetWins: s.targetWins,
    gameNo: s.gameNo,
    lastTrick: s.lastTrick ? { winnerSeat: s.lastTrick.winnerSeat, points: s.lastTrick.points } : null,
    gameResult: s.gameResult,
    winnerTeam: s.winnerTeam,
    legal,
  };
}

export const engine: MatchEngine<BiscaState, Action> = {
  id: 'bisca',
  economy: 'match',

  create(config, players: SeatPlayer[], ctx: EngineCtx) {
    const n = players.length;
    const s: BiscaState = {
      n,
      turnMs: (config.turnSeconds ?? 20) * 1000,
      targetWins: config.targetWins ?? 1,
      players: players.map((p) => ({ ...p })),
      stock: [],
      trumpSuit: 'S',
      hands: [],
      table: [],
      leader: 0,
      turnSeat: null,
      points: [0, 0],
      wins: [0, 0],
      gameNo: 1,
      firstSeat: Math.floor(ctx.rng() * n),
      lastTrick: null,
      nextLeader: null,
      gameResult: null,
      phase: 'play',
      pause: null,
      winnerTeam: null,
    };
    startGame(s, ctx.rng);
    return { state: s, events: gameStartEvents(s) };
  },

  applyAction(state, seat, action, _ctx) {
    if (state.phase === 'over') return err('A partida já terminou.');
    if (state.phase === 'pause') return err('Aguarde a próxima jogada.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= state.n) return err('Assento inválido.');
    if (!action || typeof action !== 'object') return err('Ação inválida.');
    const s = structuredClone(state);
    switch (action.type) {
      case 'play': return doPlay(s, seat, action.cardId);
      case 'swapTrump': return doSwap(s, seat);
      default: return err('Ação desconhecida.');
    }
  },

  advance(state, ctx) {
    if (state.phase !== 'pause') return { state };
    const s = structuredClone(state);
    if (s.pause === 'trick') {
      const events: GameEvent[] = [];
      const first = s.nextLeader ?? 0;
      s.table = [];
      const bottom = s.stock.length > 0 ? s.stock[s.stock.length - 1] : null;
      const drawers: number[] = [];
      let bottomTaker: number | null = null;
      for (let k = 0; k < s.n && s.stock.length > 0; k++) {
        const seat = (first + k) % s.n;
        const card = s.stock.shift()!;
        s.hands[seat].push(card);
        drawers.push(seat);
        if (bottom && card.id === bottom.id) bottomTaker = seat;
      }
      if (drawers.length === s.n) events.push({ type: 'draw', text: 'Todos compraram uma carta' });
      else if (drawers.length > 0) {
        events.push({ type: 'draw', text: `Compraram carta: ${drawers.map((d) => s.players[d].name).join(', ')}` });
      }
      if (bottom && bottomTaker !== null) {
        events.push({
          type: 'draw', seat: bottomTaker,
          text: `${s.players[bottomTaker].name} comprou a carta do trunfo (${cardLabel(bottom)}). O monte acabou`,
          data: { cards: [bottom] },
        });
      }
      s.leader = first;
      s.nextLeader = null;
      if (s.hands.every((h) => h.length === 0)) return finishGame(s, events);
      s.turnSeat = first;
      s.phase = 'play';
      s.pause = null;
      return { state: s, events };
    }
    s.gameNo += 1;
    startGame(s, ctx.rng);
    return { state: s, events: gameStartEvents(s) };
  },

  getView,

  getTurn(state) {
    return { seats: state.phase === 'play' && state.turnSeat !== null ? [state.turnSeat] : [], timeoutMs: state.turnMs };
  },

  timeoutAction: (state, seat) => timeout(state, seat),
  botAction: (state, seat, ctx) => bot(state, seat, ctx),

  getResult(state): MatchResult | null {
    if (state.phase !== 'over' || state.winnerTeam === null) return null;
    const w = state.winnerTeam;
    const winners = Array.from({ length: state.n }, (_, i) => i).filter((i) => teamOf(i, state.n) === w);
    const detail = state.targetWins === 1
      ? `${state.gameResult?.points[w] ?? 0} a ${state.gameResult?.points[1 - w] ?? 0}`
      : `${state.wins[w]} a ${state.wins[1 - w]} em jogos`;
    return { winners, summary: `${teamName(state, w)} venceu por ${detail}` };
  },

  replaceWithBot(state, seat, botName) {
    const s = structuredClone(state);
    if (s.players[seat]) s.players[seat] = { userId: `bot:${seat}`, name: botName, isBot: true };
    return s;
  },
};
