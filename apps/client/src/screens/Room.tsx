import { Suspense, useCallback, useEffect, useState } from 'react';
import { GAMES } from '@cards/shared';
import { GAME_VIEWS } from '../games/registry';
import { act } from '../net/actions';
import { call } from '../net/socket';
import { useStore } from '../store';
import { askConfirm } from '../ui/dialogs';
import { IconBack, IconChat, IconCopy, IconCrown, IconEye, IconEyeOff, IconHistory } from '../ui/icons';
import { setHideMyCards, useHideMyCards } from '../ui/privacy';
import { ErrorBoundary, Spinner } from '../ui/widgets';
import { ChatDrawer } from './room/Chat';
import { ChatPops, TableLog } from './room/TableLog';
import { PreMatch } from './room/PreMatch';
import { MatchResultBar, SessionBar } from './room/RoomBars';

export function Room() {
  const room = useStore((s) => s.room)!;
  const me = useStore((s) => s.me)!;
  const gameView = useStore((s) => s.gameView);
  const unread = useStore((s) => s.unread);
  const chatOpen = useStore((s) => s.chatOpen);
  const setChatOpenRaw = useStore((s) => s.setChatOpen);
  const [historyOpen, setHistoryOpen] = useState(false);
  // chat e histórico ocupam o mesmo lado: abrir um fecha o outro
  const setChatOpen = (open: boolean) => { if (open) setHistoryOpen(false); setChatOpenRaw(open); };
  const setRoom = useStore((s) => s.setRoom);
  const toast = useStore((s) => s.toast);

  const game = GAMES[room.gameId];
  const mySeat = room.seats.findIndex((s) => s?.userId === me.id);
  const seated = mySeat >= 0;
  const isHost = room.hostUserId === me.id;
  const isSession = game.economy === 'session';
  const view = gameView && gameView.roomId === room.id ? gameView : null;

  const leave = async () => {
    if (!isSession && seated && room.status === 'playing') {
      const ok = await askConfirm({
        title: 'Sair da partida?',
        message: 'Você perde a aposta e um bot assume o seu lugar.',
        confirmLabel: 'Sair', danger: true,
      });
      if (!ok) return;
    }
    const res = await act('room:leave', {});
    if (res.ok) setRoom(null);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = room.code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('success', `Código ${room.code} copiado.`);
  };

  const sendAction = useCallback(async (action: unknown) => {
    const res = await call('game:action', { action });
    if (!res.ok) {
      useStore.getState().toast('error', res.error);
      return { ok: false, error: res.error };
    }
    return { ok: true };
  }, []);

  const showGame = isSession ? true : room.status !== 'waiting';
  const hideCards = useHideMyCards();

  return (
    <div className={`room${hideCards ? ' hide-my-cards' : ''}`}>
      <header className="room-head">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void leave()} title="Sair da sala">
          <IconBack /> Sair
        </button>
        <div className="room-head-title">
          <strong title={room.name}>{room.name}</strong>
          <span className="muted-text">
            {game.name}{isHost && <> · <IconCrown width={11} height={11} className="crown" /> host</>}
          </span>
        </div>
        {!seated && <span className="badge badge-info" title="Você está apenas assistindo"><IconEye width={11} height={11} /> espectador</span>}
        <button type="button" className="code-chip" onClick={() => void copyCode()} title="Copiar código de convite">
          {room.code} <IconCopy width={12} height={12} />
        </button>
        <button type="button" className={`btn btn-sm btn-ghost${hideCards ? ' tb-on' : ''}`} onClick={() => setHideMyCards(!hideCards)}
          title={hideCards ? 'Mostrar minhas cartas' : 'Esconder minhas cartas (passe o mouse na mão para espiar)'}
          aria-pressed={hideCards}>
          {hideCards ? <IconEyeOff /> : <IconEye />}
        </button>
        <button type="button" className={`btn btn-sm btn-ghost${historyOpen ? ' tb-on' : ''}`} title="Histórico da mesa" aria-pressed={historyOpen}
          onClick={() => { if (!historyOpen) setChatOpenRaw(false); setHistoryOpen(!historyOpen); }}>
          <IconHistory />
        </button>
        <button type="button" className="btn btn-sm btn-ghost chat-toggle" onClick={() => setChatOpen(!chatOpen)} title="Chat">
          <IconChat />
          {unread > 0 && <span className="notif">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </header>

      {isSession && <SessionBar room={room} mySeat={seated ? mySeat : null} isHost={isHost} />}
      {!isSession && room.status === 'finished' && <MatchResultBar room={room} isHost={isHost} />}
      {!isSession && room.status === 'playing' && !seated && (
        <div className="room-bar room-bar-info"><IconEye width={13} height={13} /> Você está assistindo a partida.</div>
      )}

      <div className="room-game">
        {!isSession && room.status === 'waiting' && <PreMatch room={room} mySeat={seated ? mySeat : null} isHost={isHost} />}
        {showGame && (
          view ? (
            <ErrorBoundary resetKey={`${room.id}:${room.gameId}`}>
              <Suspense fallback={<Spinner label="Carregando mesa…" />}>
                <GameScreen room={room} view={view} sendAction={sendAction} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="empty">
              {isSession ? 'Aguardando a mesa…' : 'Aguardando o início da partida…'}
            </div>
          )
        )}
        <EventTicker />
        {!chatOpen && <ChatPops onOpen={() => setChatOpen(true)} />}
        {chatOpen && <ChatDrawer room={room} onClose={() => setChatOpen(false)} />}
        {historyOpen && <TableLog onClose={() => setHistoryOpen(false)} />}
      </div>
    </div>
  );
}

function GameScreen({ room, view, sendAction }: {
  room: NonNullable<ReturnType<typeof useStore.getState>['room']>;
  view: NonNullable<ReturnType<typeof useStore.getState>['gameView']>;
  sendAction: (a: unknown) => Promise<{ ok: boolean; error?: string }>;
}) {
  const View = GAME_VIEWS[room.gameId];
  return <View view={view.view} mySeat={view.mySeat} room={room} turn={view.turn} sendAction={sendAction} />;
}

/** Linha discreta com o último evento do jogo, some depois de alguns segundos */
function EventTicker() {
  const ticker = useStore((s) => s.ticker);
  const [visibleId, setVisibleId] = useState<number | null>(null);
  useEffect(() => {
    if (!ticker) return;
    setVisibleId(ticker.id);
    const t = setTimeout(() => setVisibleId(null), 4000);
    return () => clearTimeout(t);
  }, [ticker]);
  if (!ticker || visibleId !== ticker.id) return null;
  return <div className="ticker" key={ticker.id}>{ticker.text}</div>;
}
