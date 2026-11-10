import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { GameId } from '@cards/shared';
import type { GameViewProps } from './types';

export const GAME_VIEWS: Record<GameId, LazyExoticComponent<ComponentType<GameViewProps>>> = {
  poker: lazy(() => import('./poker/View')),
  blackjack: lazy(() => import('./blackjack/View')),
  truco: lazy(() => import('./truco/View')),
  bisca: lazy(() => import('./bisca/View')),
  sueca: lazy(() => import('./sueca/View')),
  copas: lazy(() => import('./copas/View')),
  fodinha: lazy(() => import('./fodinha/View')),
  cacheta: lazy(() => import('./cacheta/View')),
  pife: lazy(() => import('./pife/View')),
};
