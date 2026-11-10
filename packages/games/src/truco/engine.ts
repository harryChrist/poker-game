import {
  cardLabel, deck40, shuffle,
  type EngineCtx, type EngineError, type GameEvent, type MatchEngine, type MatchResult, type SeatPlayer, type StepResult,
} from '@cards/shared';
import type { Action, HandReason, Legal, Team, TrucoState, TrucoView } from './types';
import { botAction as bot, timeoutAction as timeout } from './bot';
import {
  canRequest, decideHand, nextAdversary, nextRank, nextValue, partnerSeat, resolveTrick, teamName, teamOf, valueLabel,
} from './rules';

export const TRICK_PAUSE_MS = 1200;
export const HAND_PAUSE_MS = 3000;
export const WIN_SCORE = 12;

const err = (error: string): EngineError => ({ error });

function seatName(s: TrucoState, seat: number): string {
  return s.players[seat]?.name ?? `Assento ${seat + 1}`;
}

function scoreText(s: TrucoState): string {
  return `${teamName(s, 0)} ${s.scores[0]} x ${s.scores[1]} ${teamName(s, 1)}`;
}

/** Eventos públicos do início da mão: separador, vira/manilha e modo especial (nada de cartas escondidas). */
function handStartEvents(s: TrucoState): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'hand_start', text: `Mão #${s.handNo}` },
    {
      type: 'vira', text: `Vira: ${cardLabel(s.vira)} — manilha ${s.manilha}`,
      data: { cards: [s.vira], manilha: s.manilha },
    },
  ];
  if (s.mode === 'onze' && s.onzeTeam !== null) {
    events.push({ type: 'onze', text: `Mão de onze: ${teamName(s, s.onzeTeam)} tem 11 pontos e decide se joga (vale 3)` });
  } else if (s.mode === 'ferro') {
    events.push({ type: 'ferro', text: 'Mão de ferro (11 x 11): ninguém vê as próprias cartas e a mão vale 1' });
  }
  return events;
}

/** Dá as cartas e prepara a mão (handSeat e placar já definidos) */
export function startHand(s: TrucoState, rng: () => number): void {
  const deck = shuffle(deck40(), rng);
  s.hands = Array.from({ length: s.n }, (_, i) => deck.slice(i * 3, i * 3 + 3));
  s.vira = deck[s.n * 3];
  s.manilha = nextRank(s.vira.r);
  s.value = 1;
  s.pendingValue = null;
  s.lastRequestTeam = null;
  s.requestSeat = null;
  s.respondSeat = null;
  s.table = [];
  s.tricks = [];
  s.nextLeader = null;
  s.handResult = null;
  s.pause = null;
  s.onzeTeam = null;
  const [a, b] = s.scores;
  if (a === 11 && b === 11) {
    s.mode = 'ferro';
  } else if (a === 11 || b === 11) {
    s.mode = 'onze';
    s.onzeTeam = a === 11 ? 0 : 1;
  } else {
    s.mode = 'normal';
  }
  if (s.mode === 'onze') {
    s.phase = 'decide11';
    s.turnSeat = null;
    // quem decide: primeiro jogador do time, a partir da mão
    let seat = s.handSeat;
    while (teamOf(seat) !== s.onzeTeam) seat = (seat + 1) % s.n;
    s.respondSeat = seat;
  } else {
    s.phase = 'play';
    s.turnSeat = s.handSeat;
  }
}

function endHand(
  s: TrucoState, winnerTeam: Team | null, points: number, reason: HandReason, text: string, events: GameEvent[],
): StepResult<TrucoState> {
  if (winnerTeam !== null) s.scores[winnerTeam] = Math.min(WIN_SCORE, s.scores[winnerTeam] + points);
  s.handResult = { winnerTeam, points: winnerTeam === null ? 0 : points, reason, text };
  s.turnSeat = null;
  s.respondSeat = null;
  s.pendingValue = null;
  s.requestSeat = null;
  events.push({ type: 'handEnd', text: `${text.replace(/\.$/, '')}. Placar: ${scoreText(s)}`, data: { winnerTeam, points } });
  if (s.scores[0] >= WIN_SCORE || s.scores[1] >= WIN_SCORE) {
    s.phase = 'over';
    s.pause = null;
    s.winnerTeam = s.scores[0] >= WIN_SCORE ? 0 : 1;
    events.push({ type: 'matchEnd', text: `${teamName(s, s.winnerTeam)} venceu a partida por ${s.scores[s.winnerTeam]} a ${s.scores[1 - s.winnerTeam]}` });
    return { state: s, events };
  }
  s.phase = 'pause';
  s.pause = 'hand';
  return { state: s, events, advanceInMs: HAND_PAUSE_MS };
}

function finishTrick(s: TrucoState, events: GameEvent[]): StepResult<TrucoState> {
  const res = resolveTrick(s.table, s.manilha);
  s.tricks.push({ plays: s.table.map((p) => ({ ...p })), winnerSeat: res.winnerSeat, winnerTeam: res.winnerTeam });
  const outcome = decideHand(s.tricks.map((t) => t.winnerTeam));
  if (res.winnerSeat === null) events.push({ type: 'trick', text: 'Vaza empatada (cangou)' });
  else events.push({ type: 'trick', seat: res.winnerSeat, text: `${seatName(s, res.winnerSeat)} levou a vaza` });
  if (outcome.done) {
    if (outcome.winnerTeam === null) {
      return endHand(s, null, 0, 'tie', 'Todas as vazas empataram. Ninguém pontua.', events);
    }
    const t = outcome.winnerTeam;
    return endHand(s, t, s.value, 'tricks', `${teamName(s, t)} ganhou a mão (+${s.value})`, events);
  }
  s.nextLeader = res.winnerSeat ?? s.table[0].seat;
  s.turnSeat = null;
  s.phase = 'pause';
  s.pause = 'trick';
  return { state: s, events, advanceInMs: TRICK_PAUSE_MS };
}

function doPlay(s: TrucoState, seat: number, a: Extract<Action, { type: 'play' }>): StepResult<TrucoState> | EngineError {
  if (s.phase === 'respond') return err('Responda ao pedido de truco primeiro.');
  if (s.phase === 'decide11') return err('Decida a mão de onze primeiro.');
  if (s.phase !== 'play' || seat !== s.turnSeat) return err('Não é a sua vez.');
  const hand = s.hands[seat];
  let idx = -1;
  if (typeof a.cardId === 'string') idx = hand.findIndex((c) => c.id === a.cardId);
  else if (typeof a.index === 'number' && Number.isInteger(a.index)) idx = a.index;
  if (idx < 0 || idx >= hand.length) return err('Carta inválida.');
  const hidden = a.hidden === true;
  if (hidden && s.tricks.length === 0) return err('Só é possível jogar encoberta a partir da 2ª vaza.');
  const [card] = hand.splice(idx, 1);
  s.table.push({ seat, card, hidden });
  const events: GameEvent[] = [{
    type: 'play', seat,
    text: hidden ? `${seatName(s, seat)} jogou uma carta encoberta` : `${seatName(s, seat)} jogou ${cardLabel(card)}`,
  }];
  if (s.table.length === s.n) return finishTrick(s, events);
  s.turnSeat = (seat + 1) % s.n;
  return { state: s, events };
}

function doRequest(s: TrucoState, seat: number): StepResult<TrucoState> | EngineError {
  if (s.phase !== 'play' || seat !== s.turnSeat) return err('Só é possível pedir truco na sua vez de jogar.');
  if (s.mode !== 'normal') return err('Não é permitido pedir truco nesta mão.');
  if (!canRequest(s, seat)) {
    if (nextValue(s.value) === null) return err('A mão já vale 12.');
    return err('Seu time não pode aumentar agora.');
  }
  const next = nextValue(s.value)!;
  s.pendingValue = next;
  s.requestSeat = seat;
  s.lastRequestTeam = teamOf(seat);
  s.respondSeat = nextAdversary(seat, s.n);
  s.phase = 'respond';
  return {
    state: s,
    events: [{ type: 'request', seat, text: `${seatName(s, seat)} pediu ${valueLabel(next)}!`, data: { value: next } }],
  };
}

function doRespond(s: TrucoState, seat: number, a: Action): StepResult<TrucoState> | EngineError {
  if (s.phase !== 'respond' || seat !== s.respondSeat || s.pendingValue === null || s.requestSeat === null) {
    return err('Não há pedido para responder.');
  }
  if (a.type === 'accept') {
    const v = s.pendingValue;
    s.value = v;
    s.pendingValue = null;
    s.respondSeat = null;
    s.requestSeat = null;
    s.phase = 'play';
    return { state: s, events: [{ type: 'accept', seat, text: `${seatName(s, seat)} aceitou! A mão vale ${v}.`, data: { value: v } }] };
  }
  if (a.type === 'run') {
    const winner = teamOf(s.requestSeat);
    const events: GameEvent[] = [{ type: 'run', seat, text: `${seatName(s, seat)} correu!` }];
    const pts = s.value;
    return endHand(s, winner, pts, 'run', `${seatName(s, seat)} correu. ${teamName(s, winner)} marca ${pts}`, events);
  }
  // raise
  const next = nextValue(s.pendingValue);
  if (next === null) return err('Não dá para aumentar mais.');
  s.value = s.pendingValue;
  s.pendingValue = next;
  s.requestSeat = seat;
  s.lastRequestTeam = teamOf(seat);
  s.respondSeat = nextAdversary(seat, s.n);
  return {
    state: s,
    events: [{
      type: 'raise', seat, text: `${seatName(s, seat)} aumentou: pediu ${valueLabel(next)}!`, data: { value: next },
    }],
  };
}

function doDecide11(s: TrucoState, seat: number, a: Action): StepResult<TrucoState> | EngineError {
  if (s.phase !== 'decide11' || seat !== s.respondSeat) return err('Não há decisão de mão de onze para você.');
  if (a.type === 'play11') {
    s.value = 3;
    s.respondSeat = null;
    s.phase = 'play';
    s.turnSeat = s.handSeat;
    return { state: s, events: [{ type: 'play11', seat, text: `${seatName(s, seat)} vai jogar a mão de onze (vale 3)` }] };
  }
  const winner = (1 - teamOf(seat)) as Team;
  const events: GameEvent[] = [{ type: 'run11', seat, text: `${seatName(s, seat)} correu da mão de onze` }];
  return endHand(s, winner, 1, 'run11', `${teamName(s, teamOf(seat))} correu da mão de onze. ${teamName(s, winner)} marca 1`, events);
}

function buildLegal(s: TrucoState, seat: number): Legal | null {
  if (s.phase === 'decide11' && s.respondSeat === seat) return { kind: 'decide11' };
  if (s.phase === 'respond' && s.respondSeat === seat && s.pendingValue !== null) {
    const raiseValue = nextValue(s.pendingValue);
    return {
      kind: 'respond', pendingValue: s.pendingValue, runPoints: s.value,
      canRaise: raiseValue !== null, raiseValue, raiseLabel: raiseValue === null ? null : valueLabel(raiseValue),
    };
  }
  if (s.phase === 'play' && s.turnSeat === seat) {
    const canTruco = canRequest(s, seat);
    const tv = canTruco ? nextValue(s.value) : null;
    const byIndex = s.mode === 'ferro';
    return {
      kind: 'play',
      cards: byIndex ? [] : s.hands[seat].map((c) => c.id),
      byIndex,
      canHide: s.tricks.length >= 1,
      canTruco,
      trucoValue: tv,
      trucoLabel: tv === null ? null : valueLabel(tv),
    };
  }
  return null;
}

function getView(s: TrucoState, seat: number | null): TrucoView {
  const myTeam: Team = seat === null ? 0 : teamOf(seat);
  const ferro = s.mode === 'ferro';
  const partner = seat === null ? null : partnerSeat(seat, s.n);
  const showPartner = partner !== null && s.phase === 'decide11' && s.onzeTeam === myTeam;
  const mask = (plays: { seat: number; card: any; hidden: boolean }[]) =>
    plays.map((p) => ({ seat: p.seat, card: p.hidden ? ({ hidden: true } as const) : p.card }));
  const phase: TrucoView['phase'] =
    s.phase === 'pause' ? (s.pause === 'hand' ? 'handEnd' : 'trickEnd') : s.phase;
  return {
    n: s.n,
    mySeat: seat,
    myTeam,
    players: s.players.map((p) => ({ name: p.name, isBot: p.isBot })),
    scores: [s.scores[0], s.scores[1]],
    phase,
    mode: s.mode,
    onzeTeam: s.onzeTeam,
    handSeat: s.handSeat,
    vira: s.vira,
    manilha: s.manilha,
    value: s.value,
    pendingValue: s.pendingValue,
    requestSeat: s.requestSeat,
    respondSeat: s.respondSeat,
    turnSeat: s.turnSeat,
    myHand: seat === null ? [] : s.hands[seat].map((c) => (ferro ? ({ hidden: true } as const) : c)),
    partnerHand: showPartner ? s.hands[partner!].slice() : null,
    handCounts: s.hands.map((h) => h.length),
    table: mask(s.table),
    tricks: s.tricks.map((t) => ({ winnerSeat: t.winnerSeat, winnerTeam: t.winnerTeam, plays: mask(t.plays) })),
    trickDots: s.tricks.map((t) => (t.winnerTeam === null ? 'tie' : t.winnerTeam === myTeam ? 'me' : 'opp')),
    handResult: s.handResult,
    winnerTeam: s.winnerTeam,
    legal: seat === null ? null : buildLegal(s, seat),
  };
}

export const engine: MatchEngine<TrucoState, Action> = {
  id: 'truco',
  economy: 'match',

  create(config, players: SeatPlayer[], ctx: EngineCtx) {
    const n = players.length;
    const s: TrucoState = {
      n,
      turnMs: (config.turnSeconds ?? 25) * 1000,
      players: players.map((p) => ({ ...p })),
      scores: [0, 0],
      handSeat: Math.floor(ctx.rng() * n),
      handNo: 1,
      hands: [],
      vira: undefined as never,
      manilha: '4',
      mode: 'normal',
      onzeTeam: null,
      value: 1,
      pendingValue: null,
      lastRequestTeam: null,
      requestSeat: null,
      respondSeat: null,
      turnSeat: null,
      table: [],
      tricks: [],
      nextLeader: null,
      phase: 'play',
      pause: null,
      handResult: null,
      winnerTeam: null,
    };
    startHand(s, ctx.rng);
    return { state: s, events: handStartEvents(s) };
  },

  applyAction(state, seat, action, _ctx) {
    if (state.phase === 'over') return err('A partida já terminou.');
    if (state.phase === 'pause') return err('Aguarde a próxima jogada.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= state.n) return err('Assento inválido.');
    if (!action || typeof action !== 'object' || typeof (action as Action).type !== 'string') return err('Ação inválida.');
    const s = structuredClone(state);
    switch (action.type) {
      case 'play': return doPlay(s, seat, action);
      case 'truco': return doRequest(s, seat);
      case 'accept':
      case 'run':
      case 'raise': return doRespond(s, seat, action);
      case 'play11':
      case 'run11': return doDecide11(s, seat, action);
      default: return err('Ação desconhecida.');
    }
  },

  advance(state, ctx) {
    if (state.phase !== 'pause') return { state };
    const s = structuredClone(state);
    if (s.pause === 'trick') {
      s.table = [];
      s.turnSeat = s.nextLeader;
      s.nextLeader = null;
      s.phase = 'play';
      s.pause = null;
      return { state: s };
    }
    // fim da pausa da mão: próxima mão
    s.handSeat = (s.handSeat + 1) % s.n;
    s.handNo += 1;
    startHand(s, ctx.rng);
    return { state: s, events: handStartEvents(s) };
  },

  getView,

  getTurn(state) {
    let seats: number[] = [];
    if (state.phase === 'play' && state.turnSeat !== null) seats = [state.turnSeat];
    else if ((state.phase === 'respond' || state.phase === 'decide11') && state.respondSeat !== null) seats = [state.respondSeat];
    return { seats, timeoutMs: state.turnMs };
  },

  timeoutAction: (state, seat) => timeout(state, seat),
  botAction: (state, seat, ctx) => bot(state, seat, ctx),

  getResult(state): MatchResult | null {
    if (state.phase !== 'over' || state.winnerTeam === null) return null;
    const w = state.winnerTeam;
    const winners = Array.from({ length: state.n }, (_, i) => i).filter((i) => teamOf(i) === w);
    return {
      winners,
      summary: `${teamName(state, w)} venceu por ${state.scores[w]} a ${state.scores[1 - w]}`,
    };
  },

  replaceWithBot(state, seat, botName) {
    const s = structuredClone(state);
    if (s.players[seat]) s.players[seat] = { userId: `bot:${seat}`, name: botName, isBot: true };
    return s;
  },
};
