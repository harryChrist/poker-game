import { useEffect, useState, type FormEvent } from 'react';
import { GAME_LIST, GAMES, type GameId, type RoomStatus, type RoomSummary } from '@cards/shared';
import { act, refreshLobby } from '../../net/actions';
import { useStore } from '../../store';
import { IconLock } from '../../ui/icons';
import { Modal } from '../../ui/Modal';
import { Empty } from '../../ui/widgets';
import { CreateRoomModal } from './CreateRoomModal';

const STATUS_LABEL: Record<RoomStatus, string> = { waiting: 'Aguardando', playing: 'Em jogo', finished: 'Finalizada' };

export function RoomsTab() {
  const rooms = useStore((s) => s.rooms);
  const [filter, setFilter] = useState<GameId | ''>('');
  const [creating, setCreating] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  useEffect(() => {
    void refreshLobby(filter || undefined);
    const t = setInterval(() => void refreshLobby(filter || undefined), 10_000);
    return () => clearInterval(t);
  }, [filter]);

  const visible = rooms.filter((r) => !filter || r.gameId === filter);

  return (
    <div className="rooms-tab">
      <div className="toolbar">
        <select className="input select" value={filter} onChange={(e) => setFilter(e.target.value as GameId | '')}
          aria-label="Filtrar por jogo">
          <option value="">Todos os jogos</option>
          {GAME_LIST.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Criar sala</button>
        <button type="button" className="btn" onClick={() => setCodeOpen(true)}>Código</button>
      </div>

      <div className="list">
        {visible.length === 0 ? (
          <Empty>Nenhuma sala pública no momento.<br />Crie uma ou entre com um código.</Empty>
        ) : visible.map((r) => <RoomRow key={r.id} room={r} />)}
      </div>

      {creating && <CreateRoomModal onClose={() => setCreating(false)} defaultGame={filter || undefined} />}
      {codeOpen && <JoinCodeModal onClose={() => setCodeOpen(false)} />}
    </div>
  );
}

function RoomRow({ room }: { room: RoomSummary }) {
  const setRoom = useStore((s) => s.setRoom);
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    const res = await act('room:join', { roomId: room.id });
    setBusy(false);
    if (res.ok) setRoom(res.data);
  };
  const full = room.seatsTaken >= room.seatsTotal;
  return (
    <div className="room-row">
      <div className="room-row-main">
        <div className="room-row-title">
          {room.isPrivate && <IconLock width={12} height={12} />}
          <span className="room-name" title={room.name}>{room.name}</span>
          <span className={`badge badge-${room.status}`}>{STATUS_LABEL[room.status]}</span>
        </div>
        <div className="room-row-meta">
          <span>{GAMES[room.gameId]?.name ?? room.gameId}</span>
          <span>host {room.hostName}</span>
          <span>{room.seatsTaken}/{room.seatsTotal} lugares</span>
          <span>{room.stakesLabel}</span>
        </div>
      </div>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void join()}>
        {full || (room.status !== 'waiting' && GAMES[room.gameId]?.economy === 'match') ? 'Assistir' : 'Entrar'}
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
