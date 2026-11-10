import { useEffect, useState } from 'react';
import type { RoomState, SeatState } from '@cards/shared';
import { act } from '../../net/actions';
import { askConfirm } from '../../ui/dialogs';

/** Humanos sentados (fora o líder) que ainda não marcaram pronto */
export function notReady(room: RoomState): SeatState[] {
  return room.seats.filter((s): s is SeatState => !!s && !s.isBot && s.userId !== room.hostUserId && !s.ready);
}

/** Selo do estado: líder / pronto / aguardando */
export function ReadyBadge({ room, seat }: { room: RoomState; seat: SeatState }) {
  if (seat.isBot) return null;
  if (seat.userId === room.hostUserId) return <span className="pill pill-host">líder</span>;
  return seat.ready
    ? <span className="pill pill-ok">✓ pronto</span>
    : <span className="pill pill-wait"><i className="pill-dot" />aguardando</span>;
}

/** Botão do próprio jogador para marcar/desmarcar pronto */
export function ReadyToggle({ seat, block }: { seat: SeatState; block?: boolean }) {
  const size = block ? ' btn-block' : ' btn-sm';
  return seat.ready ? (
    <button type="button" className={`btn btn-ghost-line${size}`} onClick={() => void act('room:ready', { ready: false })}>Cancelar pronto</button>
  ) : (
    <button type="button" className={`btn btn-primary${size}`} onClick={() => void act('room:ready', { ready: true })}>Estou pronto</button>
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

/** Contagem regressiva até o começo automático (atualiza a cada 0,5 s) */
function useSecondsLeft(at: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

const AUTO_SECONDS = 30;

/**
 * Quem está pronto e quem falta + contagem do começo automático.
 * Regra (servidor): com 2+ pessoas sentadas e metade ou mais pronta (o líder conta como pronto),
 * o jogo começa sozinho em 30 s; quem não estiver pronto sai do lugar.
 */
export function ReadySummary({ room }: { room: RoomState }) {
  const humans = room.seats.filter((s): s is SeatState => !!s && !s.isBot);
  const isReady = (s: SeatState) => s.userId === room.hostUserId || s.ready;
  const ready = humans.filter(isReady);
  const waiting = humans.filter((s) => !isReady(s));
  const secs = useSecondsLeft(room.autoStartAt);
  if (humans.length === 0) return null;
  const names = waiting.map((s) => s.name).join(', ');
  return (
    <div className={`ready-summary${secs !== null ? ' counting' : ''}`}>
      <div className="rs-row">
        <span className={`rs-count${waiting.length === 0 ? ' all' : ''}`}><b>{ready.length}/{humans.length}</b> prontos</span>
        {waiting.length > 0 && <span className="rs-wait" title={`Aguardando: ${names}`}>falta {names}</span>}
        {secs !== null && <span className="rs-timer">Começa em <b>{secs}s</b></span>}
      </div>
      {secs !== null && (
        <div className="rs-bar" role="progressbar" aria-label="Começo automático" aria-valuemin={0} aria-valuemax={AUTO_SECONDS} aria-valuenow={secs}>
          <i style={{ width: `${Math.min(100, (secs / AUTO_SECONDS) * 100)}%` }} />
        </div>
      )}
      {secs !== null
        ? waiting.length > 0 && <div className="rs-note">Quem não estiver pronto sai do lugar.</div>
        : humans.length >= 2 && <div className="rs-note">Com metade pronta, o jogo começa sozinho em 30 s.</div>}
    </div>
  );
}
