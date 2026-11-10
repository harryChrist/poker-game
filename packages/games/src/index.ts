import type { AnyEngine, GameId } from '@cards/shared';
import { engine as poker } from './poker';
import { engine as blackjack } from './blackjack';
import { engine as truco } from './truco';
import { engine as bisca } from './bisca';
import { engine as sueca } from './sueca';
import { engine as copas } from './copas';
import { engine as fodinha } from './fodinha';
import { engine as cacheta } from './cacheta';
import { engine as pife } from './pife';

/**
 * Cada pasta src/<jogo>/index.ts exporta:
 *   export const engine: SessionEngine | MatchEngine
 *   export type View = ...    (formato de getView, usado pelo cliente)
 *   export type Action = ...  (ações aceitas, usadas pelo cliente)
 */
export const ENGINES: Record<GameId, AnyEngine> = {
  poker, blackjack, truco, bisca, sueca, copas, fodinha, cacheta, pife,
};
