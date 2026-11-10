/**
 * Motor genérico para Cacheta e Pife (jogos de formar trincas e sequências com 9 cartas).
 * Cada jogo cria seu motor com `createRummyEngine(variant)`.
 */
import {
  deck40, deck52, shuffle, cardLabel, RANK_LABEL,
  type Card, type EngineCtx, type MatchEngine, type MatchResult,
  type SeatPlayer, type StepResult, type GameEvent,
} from '@cards/shared';
import { knockOptions, orderKnockDiscards, chooseDiscard, shouldTakeDiscard } from './ai';
import { bestArrangement, rulesFor, sortHand, wildRankFor, CACHETA_ORDER } from './melds';
import type {
  RummyAction, RummyGame, RummyState, RummyView, Reveal, RevealHand,
} from './types';

export const HAND_SIZE = 9;
const ROUND_END_MS = 4000;

export interface RummyVariant {
  id: RummyGame;
  makeDeck(players: number): Card[];
  /** Quantas vezes o monte pode ser reembaralhado antes de anular a rodada */
  maxReshuffles: number;
}

function ruleset(s: RummyState) {
  return rulesFor(s.game, s.wildRank);
}

function nextAlive(s: RummyState, from: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (s.alive[seat]) return seat;
  }
  return from;
}

function aliveSeats(s: RummyState): number[] {
  return s.players.map((_, i) => i).filter((i) => s.alive[i]);
}

function nameOf(s: RummyState, seat: number): string {
  return s.players[seat].name;
}

function startRound(s: RummyState, variant: RummyVariant, ctx: EngineCtx, firstRound: boolean): void {
  const n = s.players.length;
  s.round += 1;
  s.dealer = firstRound ? Math.floor(ctx.rng() * n) : nextAlive(s, s.dealer);
  if (firstRound && !s.alive[s.dealer]) s.dealer = nextAlive(s, s.dealer);
  const seats = aliveSeats(s);
  s.deck = shuffle(variant.makeDeck(n), ctx.rng);
  s.discard = [];
  s.hands = s.players.map(() => []);
  // distribui uma carta por vez, a partir de quem está à esquerda do distribuidor
  const order: number[] = [];
  let cur = s.dealer;
  for (let i = 0; i < seats.length; i++) { cur = nextAlive(s, cur); order.push(cur); }
  for (let k = 0; k < HAND_SIZE; k++) for (const seat of order) s.hands[seat].push(s.deck.pop()!);
  if (variant.id === 'cacheta') {
    s.vira = s.deck.pop()!;
    s.wildRank = wildRankFor(CACHETA_ORDER, s.vira.r);
  } else {
    s.vira = null;
    s.wildRank = null;
  }
  const rules = ruleset(s);
  for (const seat of seats) s.hands[seat] = sortHand(rules, s.hands[seat]);
  s.turn = order[0];
  s.step = 'draw';
  s.drawnId = null;
  s.drawnFromDiscard = false;
  s.reshuffles = 0;
  s.reveal = null;
  s.phase = 'play';
}

function roundEvents(s: RummyState): GameEvent[] {
  const events: GameEvent[] = [
    { type: 'hand_start', text: `Mão #${s.round}` },
    { type: 'deal', seat: s.dealer, text: `${nameOf(s, s.dealer)} deu as cartas.` },
  ];
  if (s.vira && s.wildRank) {
    events.push({
      type: 'wild', data: { cards: [s.vira] },
      text: `Vira: ${cardLabel(s.vira)}. Curinga: ${RANK_LABEL[s.wildRank]}.`,
    });
  }
  return events;
}

function revealEvents(s: RummyState, reveal: Reveal): GameEvent[] {
  const events: GameEvent[] = [];
  for (const h of reveal.hands) {
    const groups = h.groups.map((g) => `[${g.map(cardLabel).join(' ')}]`).join(' ');
    const loose = h.loose.length ? `soltas: ${h.loose.map(cardLabel).join(' ')}` : 'sem cartas soltas';
    events.push({
      type: 'reveal', seat: h.seat, data: { cards: h.cards },
      text: `${nameOf(s, h.seat)}${h.knocker ? ' (bateu)' : ''}: ${groups ? groups + ' ' : ''}${loose}`,
    });
  }
  return events;
}

function buildReveal(s: RummyState, kind: 'knock' | 'void', knocker: number | null, discarded: Card | null,
  losers: number[], eliminated: number[], text: string): Reveal {
  const rules = ruleset(s);
  const hands: RevealHand[] = [];
  for (const seat of aliveSeatsWithCards(s)) {
    const arr = bestArrangement(rules, s.hands[seat]);
    hands.push({
      seat,
      cards: [...arr.groups.flat(), ...arr.loose],
      groups: arr.groups,
      loose: arr.loose,
      knocker: seat === knocker,
      delta: seat === knocker ? (s.game === 'pife' ? 1 : 0) : losers.includes(seat) ? -1 : 0,
      score: s.scores[seat],
      eliminated: eliminated.includes(seat),
    });
  }
  return { kind, knocker, discarded, hands, text };
}

function aliveSeatsWithCards(s: RummyState): number[] {
  return s.players.map((_, i) => i).filter((i) => s.hands[i].length > 0);
}

/** Depois de um descarte: passa a vez e cuida do monte vazio. Devolve o StepResult de uma rodada anulada, se for o caso. */
function passTurn(s: RummyState, variant: RummyVariant, ctx: EngineCtx, events: GameEvent[]): StepResult<RummyState> | null {
  s.turn = nextAlive(s, s.turn);
  s.step = 'draw';
  s.drawnId = null;
  s.drawnFromDiscard = false;
  if (s.deck.length === 0) {
    if (s.reshuffles >= variant.maxReshuffles || s.discard.length < 2) {
      const text = 'O monte acabou de novo. Rodada anulada, as cartas serão redistribuídas.';
      s.reveal = buildReveal(s, 'void', null, null, [], [], text);
      s.phase = 'roundEnd';
      events.push({ type: 'void', text }, ...revealEvents(s, s.reveal));
      return { state: s, events, advanceInMs: ROUND_END_MS };
    }
    const top = s.discard.pop()!;
    s.deck = shuffle(s.discard, ctx.rng);
    s.discard = [top];
    s.reshuffles += 1;
    events.push({ type: 'reshuffle', text: 'O monte acabou: o descarte foi embaralhado e virou o novo monte.' });
  }
  return null;
}

function finishKnock(s: RummyState, seat: number, discarded: Card | null, events: GameEvent[]): StepResult<RummyState> {
  const losers: number[] = [];
  const eliminated: number[] = [];
  const name = nameOf(s, seat);
  let text: string;
  if (s.game === 'cacheta') {
    for (const o of aliveSeats(s)) {
      if (o === seat) continue;
      losers.push(o);
      s.scores[o] -= 1;
      if (s.scores[o] <= 0) { s.scores[o] = 0; s.alive[o] = false; eliminated.push(o); }
    }
    text = `${name} bateu! Os outros perdem 1 vida.`;
    if (eliminated.length) text += ` Fora: ${eliminated.map((e) => nameOf(s, e)).join(', ')}.`;
  } else {
    s.scores[seat] += 1;
    text = `${name} bateu e ganhou a rodada!`;
  }
  s.reveal = buildReveal(s, 'knock', seat, discarded, losers, eliminated, text);
  s.phase = 'roundEnd';
  events.push({ type: 'knock', seat, text: `${name} bateu!` }, ...revealEvents(s, s.reveal));
  if (s.game === 'cacheta') {
    for (const o of losers) {
      const left = s.scores[o];
      events.push({
        type: 'score', seat: o,
        text: `${nameOf(s, o)} perdeu 1 vida (${left === 1 ? 'resta 1' : `restam ${left}`}).`,
      });
      if (eliminated.includes(o)) events.push({ type: 'eliminated', seat: o, text: `${nameOf(s, o)} foi eliminado.` });
    }
  } else {
    const w = s.scores[seat];
    events.push({ type: 'score', seat, text: `${name} ganhou a rodada (${w} ${w === 1 ? 'vitória' : 'vitórias'}).` });
  }
  return { state: s, events, advanceInMs: ROUND_END_MS };
}

function concludeMatch(s: RummyState): void {
  s.phase = 'over';
  if (s.game === 'cacheta') {
    const alive = aliveSeats(s);
    s.winners = alive.length ? [alive[0]] : [];
    const w = s.winners[0];
    const lives = s.scores[w];
    s.summary = `${nameOf(s, w)} venceu a Cacheta (${lives} ${lives === 1 ? 'vida restante' : 'vidas restantes'}).`;
  } else {
    const best = Math.max(...s.scores);
    s.winners = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    const names = s.winners.map((i) => nameOf(s, i)).join(' e ');
    s.summary = `${names} venceu o Pife com ${best} ${best === 1 ? 'vitória' : 'vitórias'}.`;
  }
}

function strictCard(hand: Card[], id: unknown): number {
  if (typeof id !== 'string') return -1;
  return hand.findIndex((c) => c.id === id);
}

export function createRummyEngine(variant: RummyVariant): MatchEngine<RummyState, RummyAction> {
  function turnInfo(s: RummyState) {
    return { seats: s.phase === 'play' ? [s.turn] : [], timeoutMs: s.config.turnSeconds * 1000 };
  }

  const engine: MatchEngine<RummyState, RummyAction> = {
    id: variant.id,
    economy: 'match',

    create(config, players, ctx) {
      const s: RummyState = {
        game: variant.id,
        config: {
          turnSeconds: config.turnSeconds ?? 25,
          lives: config.lives ?? 5,
          targetWins: config.targetWins ?? 1,
        },
        players: players.map((p): SeatPlayer => ({ userId: p.userId, name: p.name, isBot: p.isBot })),
        hands: players.map(() => []),
        deck: [], discard: [], vira: null, wildRank: null,
        dealer: 0, turn: 0, step: 'draw', drawnId: null, drawnFromDiscard: false,
        round: 0, phase: 'play',
        scores: players.map(() => (variant.id === 'cacheta' ? config.lives ?? 5 : 0)),
        alive: players.map(() => true),
        reshuffles: 0, reveal: null, winners: null, summary: null,
      };
      startRound(s, variant, ctx, true);
      return { state: s, events: roundEvents(s) };
    },

    applyAction(state, seat, action, ctx) {
      const a = action as RummyAction | undefined;
      if (!a || typeof a !== 'object' || typeof (a as { type?: unknown }).type !== 'string') return { error: 'Ação inválida.' };
      if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) return { error: 'Assento inválido.' };
      if (state.phase !== 'play') return { error: 'A rodada terminou. Aguarde a próxima.' };
      if (!state.alive[seat]) return { error: 'Você está fora da partida.' };
      const s = structuredClone(state);
      const hand = s.hands[seat];
      const events: GameEvent[] = [];
      const rules = ruleset(s);

      if (a.type === 'reorder') {
        const ids = (a as { cardIds?: unknown }).cardIds;
        if (!Array.isArray(ids) || ids.length !== hand.length) return { error: 'Ordem de cartas inválida.' };
        const byId = new Map(hand.map((c) => [c.id, c]));
        const out: Card[] = [];
        for (const id of ids) {
          const c = typeof id === 'string' ? byId.get(id) : undefined;
          if (!c) return { error: 'Ordem de cartas inválida.' };
          byId.delete(c.id);
          out.push(c);
        }
        s.hands[seat] = out;
        return { state: s };
      }

      if (seat !== s.turn) return { error: 'Não é a sua vez.' };

      if (a.type === 'draw') {
        if (s.step !== 'draw') return { error: 'Você já comprou. Descarte uma carta ou bata.' };
        const from = (a as { from?: unknown }).from;
        let card: Card | undefined;
        if (from === 'deck') {
          card = s.deck.pop();
          if (!card) return { error: 'O monte está vazio.' };
        } else if (from === 'discard') {
          card = s.discard.pop();
          if (!card) return { error: 'O descarte está vazio.' };
        } else return { error: 'Escolha comprar do monte ou do descarte.' };
        hand.push(card);
        s.step = 'discard';
        s.drawnId = card.id;
        s.drawnFromDiscard = from === 'discard';
        events.push({
          type: 'draw', seat, data: { from },
          text: from === 'deck' ? `${nameOf(s, seat)} comprou do monte.` : `${nameOf(s, seat)} pegou ${cardLabel(card)} do descarte.`,
        });
        return { state: s, events };
      }

      if (a.type === 'discard') {
        if (s.step !== 'discard') return { error: 'Compre uma carta primeiro.' };
        const idx = strictCard(hand, (a as { cardId?: unknown }).cardId);
        if (idx < 0) return { error: 'Essa carta não está na sua mão.' };
        const card = hand[idx];
        if (s.drawnFromDiscard && card.id === s.drawnId) return { error: 'Você não pode descartar a carta que acabou de pegar do descarte.' };
        hand.splice(idx, 1);
        s.discard.push(card);
        events.push({ type: 'discard', seat, data: { card }, text: `${nameOf(s, seat)} descartou ${cardLabel(card)}.` });
        const voided = passTurn(s, variant, ctx, events);
        return voided ?? { state: s, events };
      }

      if (a.type === 'knock') {
        if (s.step !== 'discard') return { error: 'Compre uma carta antes de bater.' };
        const did = (a as { discardId?: unknown }).discardId;
        const opts = knockOptions(rules, hand);
        if (did === null || did === undefined) {
          if (!opts.all) return { error: 'Ainda não dá para bater' };
          return finishKnock(s, seat, null, events);
        }
        const idx = strictCard(hand, did);
        if (idx < 0) return { error: 'Essa carta não está na sua mão.' };
        if (!opts.discardIdx.includes(idx)) return { error: 'Ainda não dá para bater' };
        const [card] = hand.splice(idx, 1);
        s.discard.push(card);
        events.push({ type: 'discard', seat, data: { card }, text: `${nameOf(s, seat)} descartou ${cardLabel(card)}.` });
        return finishKnock(s, seat, card, events);
      }

      return { error: 'Ação desconhecida.' };
    },

    advance(state, ctx) {
      if (state.phase !== 'roundEnd') return { state };
      const s = structuredClone(state);
      const reveal = s.reveal;
      if (s.game === 'cacheta') {
        if (aliveSeats(s).length <= 1) { concludeMatch(s); return { state: s, events: [{ type: 'match_end', text: s.summary ?? 'Fim da partida.' }] }; }
      } else if (reveal?.kind === 'knock' && s.scores.some((v) => v >= s.config.targetWins)) {
        concludeMatch(s);
        return { state: s, events: [{ type: 'match_end', text: s.summary ?? 'Fim da partida.' }] };
      }
      startRound(s, variant, ctx, false);
      // mantém o reveal da rodada anterior só até esta redistribuição
      return { state: s, events: roundEvents(s) };
    },

    getView(state, seat): RummyView {
      const s = state;
      const rules = ruleset(s);
      const mine = seat !== null && seat >= 0 && seat < s.players.length ? s.hands[seat] : [];
      const myTurn = s.phase === 'play' && seat !== null && seat === s.turn;
      let discards: string[] = [];
      let knockDiscards: string[] = [];
      let knockAll = false;
      if (myTurn && s.step === 'discard') {
        discards = mine.filter((c) => !(s.drawnFromDiscard && c.id === s.drawnId)).map((c) => c.id);
        const opts = knockOptions(rules, mine);
        knockAll = opts.all;
        knockDiscards = orderKnockDiscards(rules, mine, opts.discardIdx, s.drawnId).map((i) => mine[i].id);
      }
      let arrangement: RummyView['arrangement'] = null;
      if (mine.length > 0) {
        const arr = bestArrangement(rules, mine);
        arrangement = { groups: arr.groups.map((g) => g.map((c) => c.id)), loose: arr.loose.map((c) => c.id) };
      }
      return {
        game: s.game,
        phase: s.phase,
        seat,
        turnSeat: s.phase === 'play' ? s.turn : null,
        turnStep: s.phase === 'play' ? s.step : null,
        dealer: s.dealer,
        round: s.round,
        scoreKind: s.game === 'cacheta' ? 'lives' : 'wins',
        target: s.game === 'cacheta' ? s.config.lives : s.config.targetWins,
        players: s.players.map((p, i) => ({
          seat: i, name: p.name, isBot: p.isBot, handCount: s.hands[i].length, score: s.scores[i], alive: s.alive[i],
        })),
        hand: mine.slice(),
        arrangement,
        drawnId: myTurn && s.step === 'discard' ? s.drawnId : null,
        discardTop: s.discard.length ? s.discard[s.discard.length - 1] : null,
        discardCount: s.discard.length,
        deckCount: s.deck.length,
        vira: s.vira,
        wildRank: s.wildRank,
        legal: {
          drawDeck: myTurn && s.step === 'draw' && s.deck.length > 0,
          drawDiscard: myTurn && s.step === 'draw' && s.discard.length > 0,
          discards,
          knock: knockDiscards.length > 0 || knockAll,
          knockDiscards,
          knockAll,
        },
        reveal: s.reveal,
        result: s.winners && s.summary ? { winners: s.winners, summary: s.summary } : null,
      };
    },

    getTurn: turnInfo,

    getResult(state): MatchResult | null {
      if (state.phase !== 'over' || !state.winners || !state.summary) return null;
      return { winners: state.winners, summary: state.summary };
    },

    replaceWithBot(state, seat, botName) {
      const s = structuredClone(state);
      if (s.players[seat]) s.players[seat] = { ...s.players[seat], isBot: true, name: botName };
      return s;
    },

    timeoutAction(state, seat): RummyAction {
      return decide(state, seat, false);
    },

    botAction(state, seat): RummyAction {
      return decide(state, seat, true);
    },
  };

  function decide(state: RummyState, seat: number, smart: boolean): RummyAction {
    const hand = state.hands[seat] ?? [];
    const rules = ruleset(state);
    if (state.phase !== 'play' || seat !== state.turn) {
      // fora da vez: só reorganizar é válido
      return { type: 'reorder', cardIds: hand.map((c) => c.id) };
    }
    if (state.step === 'draw') {
      const top = state.discard[state.discard.length - 1];
      if (smart && top && shouldTakeDiscard(rules, hand, top)) return { type: 'draw', from: 'discard' };
      if (state.deck.length > 0) return { type: 'draw', from: 'deck' };
      return { type: 'draw', from: 'discard' };
    }
    const opts = knockOptions(rules, hand);
    if (opts.discardIdx.length) {
      const [i] = orderKnockDiscards(rules, hand, opts.discardIdx, state.drawnId);
      return { type: 'knock', discardId: hand[i].id };
    }
    if (opts.all) return { type: 'knock', discardId: null };
    const forbidden = state.drawnFromDiscard ? state.drawnId : null;
    return { type: 'discard', cardId: hand[chooseDiscard(rules, hand, forbidden)].id };
  }

  return engine;
}

export function cachetaVariant(): RummyVariant {
  return { id: 'cacheta', makeDeck: () => [...deck40(1), ...deck40(2)], maxReshuffles: 8 };
}

export function pifeVariant(): RummyVariant {
  return {
    id: 'pife',
    makeDeck: (players) => (players <= 4 ? deck52(1) : [...deck52(1), ...deck52(2)]),
    maxReshuffles: 1,
  };
}
