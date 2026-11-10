import type { RoomState, SeatState } from '@cards/shared';
import { act } from '../../net/actions';
import { askConfirm } from '../../ui/dialogs';

/** Humanos sentados (fora o líder) que ainda não marcaram pronto */
export function notReady(room: RoomState): SeatState[] {
  return room.seats.filter((s): s is SeatState => !!s && !s.isBot && s.userId !== room.hostUserId && !s.ready);
}

/** Selo ao lado do nome: líder / pronto / aguardando */
export function ReadyBadge({ room, seat }: { room: RoomState; seat: SeatState }) {
  if (seat.isBot) return null;
  if (seat.userId === room.hostUserId) return <span className="badge badge-accent">líder</span>;
  return seat.ready
    ? <span className="badge badge-waiting">✓ pronto</span>
    : <span className="badge">aguardando</span>;
}

/** Botão do próprio jogador para marcar/desmarcar pronto */
export function ReadyToggle({ seat }: { seat: SeatState }) {
  return seat.ready ? (
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act('room:ready', { ready: false })}>Cancelar pronto</button>
  ) : (
    <button type="button" className="btn btn-sm btn-primary" onClick={() => void act('room:ready', { ready: true })}>Estou pronto</button>
  );
}

/** Líder remove alguém da sala (com confirmação) */
export async function kickUser(userId: string, name: string): Promise<void> {
  const ok = await askConfirm({
    title: `Remover ${name}?`,
    message: 'A pessoa sai da sala e não consegue entrar de novo nesta sala. Se estiver numa mesa de Poker/Blackjack, as fichas dela voltam para a carteira.',
    confirmLabel: 'Remover',
    danger: true,
  });
  if (ok) await act('room:kick', { userId });
}

/** Texto curto de quem falta ficar pronto */
export function waitingText(room: RoomState): string | null {
  const list = notReady(room).map((s) => s.name);
  return list.length ? `Esperando ficar pronto: ${list.join(', ')}` : null;
}
