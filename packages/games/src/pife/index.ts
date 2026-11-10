import type { MatchEngine } from '@cards/shared';
import { createRummyEngine, pifeVariant } from '../_rummy/engine';
import type { RummyAction, RummyState, RummyView } from '../_rummy/types';

export type State = RummyState;
export type Action = RummyAction;
export type View = RummyView;

/** Pife: 52 cartas (2 baralhos com 5-6 jogadores), 9 cartas, sem coringas; vence quem juntar `targetWins` vitórias. */
export const engine: MatchEngine<State, Action> = createRummyEngine(pifeVariant());
