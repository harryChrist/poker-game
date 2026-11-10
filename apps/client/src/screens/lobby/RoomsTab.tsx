import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { GAME_LIST, GAMES, type GameId, type RoomStatus, type RoomSummary } from '@cards/shared';
import { act, refreshLobby } from '../../net/actions';
import { useStore } from '../../store';
import { GAME_ART, playersLabel } from '../../ui/gameArt';
import { IconLock } from '../../ui/icons';
import { Modal } from '../../ui/Modal';
import { CreateRoomModal } from './CreateRoomModal';

const STATUS_LABEL: Record<RoomStatus, string> = { waiting: 'Aguardando', playing: 'Em jogo', finished: 'Finalizada' };

/** Sala pública aguardando gente e com lugar livre */
const isOpen = (r: RoomSummary) => r.status === 'waiting' && r.seatsTaken < r.seatsTotal;

export function RoomsTab() {
  const rooms = useStore((s) => s.rooms);
  const setRoom = useStore((s) => s.setRoom);
  const [filter, setFilter] = useState<GameId | ''>('');
  const [creating, setCreating] = useState<GameId | null | false>(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [joining, setJoining] = useState<GameId | null>(null);

  useEffect(() => {
    void refreshLobby();
    const t = setInterval(() => void refreshLobby(), 10_000);
    return () => clearInterval(t);
  }, []);

  const openCount = useMemo(() => {
    const m: Partial<Record<GameId, number>> = {};
    for (const r of rooms) if (isOpen(r)) m[r.gameId] = (m[r.gameId] ?? 0) + 1;
    return m;
  }, [rooms]);

  const visible = rooms
    .filter((r) => !filter || r.gameId === filter)
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.createdAt - a.createdAt);

  /** Jogar: entra na sala aberta mais cheia desse jogo; se não houver, cria uma */
  const play = async (gameId: GameId) => {
    const target = rooms.filter((r) => r.gameId === gameId && isOpen(r)).sort((a, b) => b.seatsTaken - a.seatsTaken)[0];
    if (!target) {
      setCreating(gameId);
      return;
    }
    setJoining(gameId);
    const res = await act('room:join', { roomId: target.id });
    setJoining(null);
    if (res.ok) setRoom(res.data);
  };

  return (
    <div className={`home${rooms.some(isOpen) ? ' home-has-open' : ''}`}>
      <section className="home-games">
        <h2 className="home-h">Escolha um jogo</h2>
        <div className="game-grid">
          {GAME_LIST.map((g) => {
            const art = GAME_ART[g.id];
            const n = openCount[g.id] ?? 0;
            return (
              <button key={g.id} type="button" className="game-card" onClick={() => void play(g.id)} disabled={joining !== null}
                style={{ '--gc': art.color } as React.CSSProperties} title={g.description}>
                <span className="game-card-icon">{art.icon}</span>
                <span className="game-card-text">
                  <span className="game-card-name">{g.name}</span>
                  <span className="game-card-sub">{art.tagline} · {playersLabel(g.playerCounts)}</span>
                </span>
                <span className={`game-card-cta ${n > 0 ? 'game-card-cta-live' : ''}`}>
                  {joining === g.id ? 'Entrando…' : n > 0 ? `${n} aberta${n > 1 ? 's' : ''} · Entrar` : 'Criar sala'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-rooms">
        <div className="home-rooms-head">
          <h2 className="home-h">Salas</h2>
          <div className="home-rooms-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(filter || null)}>+ Criar sala</button>
            <button type="button" className="btn btn-sm" onClick={() => setCodeOpen(true)}>Entrar com código</button>
          </div>
        </div>
        <div className="filter-chips" role="tablist" aria-label="Filtrar salas por jogo">
          <button type="button" className={`tut-chip ${filter === '' ? 'tut-chip-on' : ''}`} onClick={() => setFilter('')}>Todas ({rooms.length})</button>
          {GAME_LIST.filter((g) => rooms.some((r) => r.gameId === g.id)).map((g) => (
            <button key={g.id} type="button" className={`tut-chip ${filter === g.id ? 'tut-chip-on' : ''}`} onClick={() => setFilter(g.id)}>
              {g.name.split(' ')[0]} ({rooms.filter((r) => r.gameId === g.id).length})
            </button>
          ))}
        </div>

        <div className="room-cards">
          {visible.length === 0 ? (
            <div className="home-empty">
              <div className="home-empty-icon">♠ ♥ ♣ ♦</div>
              <strong>Nenhuma sala aberta agora</strong>
              <span className="muted-text">Escolha um jogo acima para criar a sua, ou entre na de um amigo pelo código.</span>
            </div>
          ) : visible.map((r) => <RoomCard key={r.id} room={r} />)}
        </div>
      </section>

      {creating !== false && <CreateRoomModal onClose={() => setCreating(false)} defaultGame={creating ?? undefined} />}
      {codeOpen && <JoinCodeModal onClose={() => setCodeOpen(false)} />}
    </div>
  );
}

function RoomCard({ room }: { room: RoomSummary }) {
  const setRoom = useStore((s) => s.setRoom);
  const [busy, setBusy] = useState(false);
  const art = GAME_ART[room.gameId];
  const join = async () => {
    setBusy(true);
    const res = await act('room:join', { roomId: room.id });
    setBusy(false);
    if (res.ok) setRoom(res.data);
  };
  const full = room.seatsTaken >= room.seatsTotal;
  const watch = full || (room.status !== 'waiting' && GAMES[room.gameId]?.economy === 'match');
  return (
    <div className="room-card" style={{ '--gc': art.color } as React.CSSProperties}>
      <span className="room-card-icon">{art.icon}</span>
      <div className="room-card-main">
        <div className="room-card-title">
          {room.isPrivate && <IconLock width={12} height={12} />}
          <span className="room-name" title={room.name}>{room.name}</span>
          <span className={`badge badge-${room.status}`}>{STATUS_LABEL[room.status]}</span>
        </div>
        <div className="room-card-meta">
          <span>{GAMES[room.gameId]?.name ?? room.gameId}</span>
          <span>{room.stakesLabel}</span>
          <span>líder {room.hostName}</span>
        </div>
        <div className="seat-dots" title={`${room.seatsTaken}/${room.seatsTotal} lugares`}>
          {Array.from({ length: room.seatsTotal }, (_, i) => <i key={i} className={i < room.seatsTaken ? 'on' : ''} />)}
          <span>{room.seatsTaken}/{room.seatsTotal}</span>
        </div>
      </div>
      <button type="button" className={`btn btn-sm ${watch ? '' : 'btn-primary'}`} disabled={busy} onClick={() => void join()}>
        {watch ? 'Assistir' : 'Entrar'}
      </button>
    </div>
  );
}

function JoinCodeModal({ onClose }: { onClose: () => void }) {
  const setRoom = useStore((s) => s.setRoom);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    const res = await act('room:join', { code: code.trim().toUpperCase() });
    setBusy(false);
    if (res.ok) {
      setRoom(res.data);
      onClose();
    }
  };
  return (
    <Modal title="Entrar com código" onClose={onClose} width={340}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span className="label">Código da sala</span>
          <input className="input code-input" autoFocus maxLength={6} value={code} spellCheck={false}
            placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 3}>Entrar</button>
        </div>
      </form>
    </Modal>
  );
}
