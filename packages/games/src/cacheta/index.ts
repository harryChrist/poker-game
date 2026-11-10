import type { MatchEngine } from '@cards/shared';
import { createRummyEngine, cachetaVariant } from '../_rummy/engine';
import type { RummyAction, RummyState, RummyView } from '../_rummy/types';

export type State = RummyState;
export type Action = RummyAction;
export type View = RummyView;

/** Cacheta: 2 baralhos de 40 cartas, 9 cartas, a vira define o coringa; quem bate tira 1 vida dos outros. */
export const engine: MatchEngine<State, Action> = createRummyEngine(cachetaVariant());
