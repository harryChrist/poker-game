import type { EngineCtx, EngineError, GameEvent, SeatPlayer, SessionEngine, StepResult } from '@cards/shared';
import { botAction as bot, safeAction } from './bot';
import {
  TIMING, advanceDealer, applyBet, applyInsurance, applyPlay, createState, leaveRound, legalFor, openBetting,
} from './rules';
import type { Action, State, View } from './types';
import { buildView, turnSeats } from './view';

export type { Action, View, State } from './types';

function clone(s: State): State {
  return structuredClone(s);
}

function step(state: State, ev: GameEvent[], advanceInMs?: number): StepResult<State> {
  const out: StepResult<State> = { state };
  if (ev.length) out.events = ev;
  if (advanceInMs !== undefined) out.advanceInMs = advanceInMs;
  return out;
}

function canOpen(s: State): boolean {
  return s.phase === 'idle' && s.seats.some((st) => st && st.stack >= s.cfg.minBet);
}

export const engine: SessionEngine<State, Action> = {
  id: 'blackjack',
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
    s.seats[seat] = { player: { ...player }, stack, lastBet: 0 };
    return step(s, [{ type: 'sit', seat, text: `${player.name} sentou na mesa` }], canOpen(s) ? TIMING.start : undefined);
  },

  standUp(state: State, seat: number, ctx: EngineCtx): StepResult<State> & { cashOut: number } {
    const st = state.seats[seat];
    if (!st) return { state, cashOut: 0 };
    const s = clone(state);
    const ev: GameEvent[] = [];
    const { refund, advanceInMs } = leaveRound(s, seat, ctx.rng, ev);
    const cashOut = s.seats[seat]!.stack + refund;
    s.seats[seat] = null;
    ev.push({ type: 'stand', seat, text: `${st.player.name} saiu da mesa` });
    return { ...step(s, ev, advanceInMs), cashOut };
  },

  addChips(state: State, seat: number, amount: number, _ctx: EngineCtx): StepResult<State> | EngineError {
    if (!state.seats[seat]) return { error: 'Você não está sentado.' };
    if (!Number.isInteger(amount) || amount < 1) return { error: 'Valor inválido.' };
    const s = clone(state);
    s.seats[seat]!.stack += amount;
    return step(s, [], canOpen(s) ? TIMING.start : undefined);
  },

  getStacks(state: State): Record<number, number> {
    const out: Record<number, number> = {};
    state.seats.forEach((st, i) => { if (st) out[i] = st.stack; });
    return out;
  },

  applyAction(state: State, seat: number, action: Action, ctx: EngineCtx): StepResult<State> | EngineError {
    if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') return { error: 'Ação inválida.' };
    const s = clone(state);
    const ev: GameEvent[] = [];
    let r: { advanceInMs?: number } | EngineError;
    switch (s.phase) {
      case 'betting': r = applyBet(s, seat, action, ctx.rng, ev); break;
      case 'insurance': r = applyInsurance(s, seat, action, ctx.rng, ev); break;
      case 'playing': r = applyPlay(s, seat, action, ctx.rng, ev); break;
      default: return { error: 'Aguarde a próxima rodada.' };
    }
    if ('error' in r) return r;
    return step(s, ev, r.advanceInMs);
  },

  advance(state: State, ctx: EngineCtx): StepResult<State> {
    const ev: GameEvent[] = [];
    switch (state.phase) {
      case 'idle': {
        if (!canOpen(state)) return { state };
        const s = clone(state);
        openBetting(s);
        return step(s, ev);
      }
      case 'result': {
        const s = clone(state);
        openBetting(s);
        return step(s, ev);
      }
      case 'dealer': {
        const s = clone(state);
        const adv = advanceDealer(s, ctx.rng, ev);
        return step(s, ev, adv);
      }
      default:
        return { state };
    }
  },

  getView(state: State, seat: number | null): View {
    return buildView(state, seat);
  },

  getTurn(state: State) {
    return { seats: turnSeats(state), timeoutMs: state.cfg.turnMs };
  },

  timeoutAction(state: State, seat: number): Action {
    return safeAction(legalFor(state, seat));
  },

  botAction(state: State, seat: number, ctx: EngineCtx): Action {
    return bot(state, seat, ctx.rng);
  },
};
