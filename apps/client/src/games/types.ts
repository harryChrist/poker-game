import type { RoomState } from '@cards/shared';

/**
 * Props que TODA tela de jogo recebe (apps/client/src/games/<id>/View.tsx, export default).
 * A tela deve caber e ficar usável em janelas pequenas (mín. ~340x460) e escalar até tela cheia.
 * Use os componentes de ../../ui/cards (Card, CardBack, Hand, SeatBadge, Chips, TurnTimer, ActionBar).
 */
export interface GameViewProps<V = any, A = any> {
  /** Retorno de engine.getView para este usuário */
  view: V;
  /** Assento do usuário (null = espectador) */
  mySeat: number | null;
  room: RoomState;
  /** Quem precisa agir e até quando (ms epoch) */
  turn: { seats: number[]; deadline: number | null };
  /** Envia uma ação ao servidor. Mostre o erro (ex.: toast) se ok=false. */
  sendAction: (action: A) => Promise<{ ok: boolean; error?: string }>;
}
