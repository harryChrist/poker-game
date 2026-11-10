import type { EngineCtx, GameEvent, SeatPlayer, SessionEngine, StepResult, EngineError } from '@cards/shared';
import { botAction as bot, safeFallback } from './bot';
import {
  TIMING, advanceReveal, applyBetAction, canStartHand, clearHand, createState, entryFor, forceFold, legalFor, startHand,
} from './rules';
import type { Action, State, View } from './types';
import { buildView } from './view';

export type { Action, View, State } from './types';
export { evaluate, scoreCards } from './evaluator';

function clone(s: State): State {
  return structuredClone(s);
}

function step(state: State, ev: GameEvent[], advanceInMs?: number): StepResult<State> {
  const out: StepResult<State> = { state };
  if (ev.length) out.events = ev;
  if (advanceInMs !== undefined) out.advanceInMs = advanceInMs;
  return out;
}

export const engine: SessionEngine<State, Action> = {
  id: 'poker',
  economy: 'session',

  create(config: Record<string, number>, _ctx: EngineCtx): State {
    return createState(config);
  },

  sitDown(state: State, seat: number, player: SeatPlayer, stack: number, _ctx: EngineCtx): StepResult<State> | EngineError {
    if (!Number.isInteger(seat) || seat < 0 || seat >= state.cfg.seats) return { error: 'Lugar inválido.' };
    if (state.seats[seat]) return { error: 'Esse lugar já está ocupado.' };
    if (!Number.isInteger(stack) || stack < 1) return { error: 'Valor de entrada inválido.' };
    if (state.seats.some((x) => x && x.player.userId === player.userId)) return { error: 'Você já está sentado nesta mesa.' };
    const s = clone(state);
    s.seats[seat] = { player: { ...player }, stack, pending: 0 };
    return step(s, [{ type: 'sit', seat, text: `${player.name} sentou na mesa` }], s.phase === 'idle' && canStartHand(s) ? TIMING.start : undefined);
  },

  standUp(state: State, seat: number, _ctx: EngineCtx): StepResult<State> & { cashOut: number } {
    const st = state.seats[seat];
    if (!st) return { state, cashOut: 0 };
    const s = clone(state);
    const ev: GameEvent[] = [];
    const cashOut = st.stack + st.pending;
    const adv = forceFold(s, seat, ev);
    s.seats[seat] = null;
    ev.push({ type: 'stand', seat, text: `${st.player.name} saiu da mesa` });
    return { ...step(s, ev, adv), cashOut };
  },

  addChips(state: State, seat: number, amount: number, _ctx: EngineCtx): StepResult<State> | EngineError {
    const st = state.seats[seat];
    if (!st) return { error: 'Você não está sentado.' };
    if (!Number.isInteger(amount) || amount < 1) return { error: 'Valor inválido.' };
    const s = clone(state);
    const me = s.seats[seat]!;
    const e = entryFor(s, seat);
    const midHand = !!e && !e.folded && (s.phase === 'betting' || s.phase === 'reveal');
    if (midHand) me.pending += amount;
    else me.stack += amount;
    return step(s, [], s.phase === 'idle' && canStartHand(s) ? TIMING.start : undefined);
  },

  getStacks(state: State): Record<number, number> {
    const out: Record<number, number> = {};
    state.seats.forEach((st, i) => { if (st) out[i] = st.stack + st.pending; });
    return out;
  },

  applyAction(state: State, seat: number, action: Action, _ctx: EngineCtx): StepResult<State> | EngineError {
    const s = clone(state);
    const ev: GameEvent[] = [];
    const r = applyBetAction(s, seat, action, ev);
    if ('error' in r) return r;
    return step(s, ev, r.advanceInMs);
  },

  advance(state: State, ctx: EngineCtx): StepResult<State> {
    if (state.phase === 'betting') return { state };
    if (state.phase === 'idle' && !canStartHand(state)) return { state };
    const s = clone(state);
    const ev: GameEvent[] = [];
    let adv: number | undefined;
    if (s.phase === 'reveal') adv = advanceReveal(s, ev);
    else {
      if (s.phase === 'result') clearHand(s);
      adv = startHand(s, ctx.rng, ev);
    }
    return step(s, ev, adv);
  },

  getView(state: State, seat: number | null): View {
    return buildView(state, seat);
  },

  getTurn(state: State) {
    return { seats: state.phase === 'betting' && state.toAct >= 0 ? [state.toAct] : [], timeoutMs: state.cfg.turnMs };
  },

  timeoutAction(state: State, seat: number): Action {
    return safeFallback(legalFor(state, seat));
  },

  botAction(state: State, seat: number, ctx: EngineCtx): Action {
    return bot(state, seat, ctx.rng);
  },
};
