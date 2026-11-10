import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { GAMES } from '@cards/shared';
import { GAME_VIEWS } from '../games/registry';
import { act } from '../net/actions';
import { call } from '../net/socket';
import { useStore } from '../store';
import { askConfirm } from '../ui/dialogs';
import { IconBack, IconChat, IconCopy, IconCrown, IconEye, IconEyeOff, IconHistory } from '../ui/icons';
import { setHideMyCards, useHideMyCards } from '../ui/privacy';
import { TutorialModal } from './lobby/TutorialTab';
import { ErrorBoundary, Spinner } from '../ui/widgets';
import { ChatDrawer } from './room/Chat';
import { ChatPops, TableLog } from './room/TableLog';
import './room/room.css';
import { PreMatch } from './room/PreMatch';
import { MatchResultBar, SessionBar } from './room/RoomBars';

const STATE_LABEL = { waiting: 'aguardando', playing: 'em jogo', finished: 'encerrada' } as const;

const IconMore = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
);

/** Menu "⋯" do cabeçalho em janelas estreitas: tutorial, esconder cartas, histórico e código */
function RoomMenu({ historyOpen, hideCards, code, gameName, onHelp, onHide, onHistory, onCopy }: {
  historyOpen: boolean; hideCards: boolean; code: string; gameName: string;
  onHelp: () => void; onHide: () => void; onHistory: () => void; onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="rh-more" ref={ref}>
      <button type="button" className={`rh-btn${open ? ' rh-on' : ''}`} onClick={() => setOpen(!open)} title="Mais opções" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={open}>
        <IconMore />
      </button>
      {open && (
        <div className="rh-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(onCopy)}>
            <IconCopy width={15} height={15} /><span>Copiar código</span><code>{code}</code>
          </button>
          <button type="button" role="menuitem" onClick={pick(onHelp)}>
            <span className="rh-q">?</span><span>Como jogar {gameName}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={hideCards} onClick={pick(onHide)}>
            {hideCards ? <IconEyeOff width={15} height={15} /> : <IconEye width={15} height={15} />}
            <span>{hideCards ? 'Mostrar minhas cartas' : 'Esconder minhas cartas'}</span>
            {hideCards && <em>ligado</em>}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={historyOpen} onClick={pick(onHistory)}>
            <IconHistory width={15} height={15} /><span>Histórico da mesa</span>
            {historyOpen && <em>aberto</em>}
          </button>
        </div>
      )}
    </div>
  );
}

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
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHistory = () => { if (!historyOpen) setChatOpenRaw(false); setHistoryOpen(!historyOpen); };

  return (
    <div className={`room${hideCards ? ' hide-my-cards' : ''}`}>
      <header className="room-head">
        <button type="button" className="rh-btn rh-back" onClick={() => void leave()} title="Sair da sala" aria-label="Sair da sala">
          <IconBack /><span className="rh-back-txt">Sair</span>
        </button>
        <div className="room-head-title">
          <strong title={room.name}>{room.name}</strong>
          <span className="rh-sub">
            <span className="rh-game" title={game.name}>{game.name}</span>
            {isHost && <IconCrown width={11} height={11} className="crown" aria-label="você é o líder" />}
            {!seated
              ? <span className="rh-state rh-state-spec"><IconEye width={10} height={10} /> espectador</span>
              : <span className={`rh-state rh-state-${room.status}`}>{STATE_LABEL[room.status]}</span>}
          </span>
        </div>
        <button type="button" className="rh-code" onClick={() => void copyCode()} title="Copiar código de convite">
          {room.code} <IconCopy width={12} height={12} />
        </button>
        <div className="rh-inline">
          <button type="button" className="rh-btn" onClick={() => setHelpOpen(true)} title={`Como jogar ${game.name}`} aria-label="Como jogar">
            <span className="rh-q">?</span>
          </button>
          <button type="button" className={`rh-btn${hideCards ? ' rh-on' : ''}`} onClick={() => setHideMyCards(!hideCards)}
            title={hideCards ? 'Mostrar minhas cartas' : 'Esconder minhas cartas (passe o mouse na mão para espiar)'}
            aria-label={hideCards ? 'Mostrar minhas cartas' : 'Esconder minhas cartas'} aria-pressed={hideCards}>
            {hideCards ? <IconEyeOff /> : <IconEye />}
          </button>
          <button type="button" className={`rh-btn${historyOpen ? ' rh-on' : ''}`} title="Histórico da mesa" aria-label="Histórico da mesa" aria-pressed={historyOpen}
            onClick={toggleHistory}>
            <IconHistory />
          </button>
        </div>
        <button type="button" className={`rh-btn rh-chat${chatOpen ? ' rh-on' : ''}`} onClick={() => setChatOpen(!chatOpen)} title="Chat" aria-label="Chat" aria-pressed={chatOpen}>
          <IconChat />
          {unread > 0 && <span className="rh-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <RoomMenu historyOpen={historyOpen} hideCards={hideCards} code={room.code} gameName={game.name}
          onHelp={() => setHelpOpen(true)} onHide={() => setHideMyCards(!hideCards)} onHistory={toggleHistory} onCopy={() => void copyCode()} />
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
      {helpOpen && <TutorialModal gameId={room.gameId} onClose={() => setHelpOpen(false)} />}
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
