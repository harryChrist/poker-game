import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { GAME_LIST, GAMES, type GameId, type RoomStatus, type RoomSummary } from '@cards/shared';
import { act, refreshLobby } from '../../net/actions';
import { useStore } from '../../store';
import { GAME_ART, GAME_SHORT } from '../../ui/gameArt';
import { IconLock } from '../../ui/icons';
import { Modal } from '../../ui/Modal';
import { CreateRoomModal } from './CreateRoomModal';

const STATUS_LABEL: Record<RoomStatus, string> = { waiting: 'Aguardando', playing: 'Em jogo', finished: 'Finalizada' };

/** Sala pública aguardando gente e com lugar livre */
const isOpen = (r: RoomSummary) => r.status === 'waiting' && r.seatsTaken < r.seatsTotal;
const byNewest = (a: RoomSummary, b: RoomSummary) => b.createdAt - a.createdAt;

export function RoomsTab() {
  const rooms = useStore((s) => s.rooms);
  const [filter, setFilter] = useState<GameId | ''>('');
  const [creating, setCreating] = useState<GameId | null | false>(false);
  const [codeOpen, setCodeOpen] = useState(false);

  useEffect(() => {
    void refreshLobby();
    const t = setInterval(() => void refreshLobby(), 10_000);
    return () => clearInterval(t);
  }, []);

  const byGame = useMemo(() => {
    const m: Partial<Record<GameId, number>> = {};
    for (const r of rooms) m[r.gameId] = (m[r.gameId] ?? 0) + 1;
    return m;
  }, [rooms]);

  // se as salas do filtro sumirem, volta para "Todas"
  useEffect(() => {
    if (filter && !byGame[filter]) setFilter('');
  }, [byGame, filter]);

  const visible = rooms.filter((r) => !filter || r.gameId === filter);
  const open = visible.filter(isOpen).sort(byNewest);
  const others = visible
    .filter((r) => !isOpen(r))
    .sort((a, b) => Number(b.status === 'playing') - Number(a.status === 'playing') || byNewest(a, b));

  return (
    <div className="lb-rooms">
      <div className="lb-actions">
        <button type="button" className="lb-cta" onClick={() => setCreating(filter || null)}>
          <span className="lb-cta-plus" aria-hidden>+</span> Criar sala
        </button>
        <button type="button" className="lb-cta lb-cta-alt" onClick={() => setCodeOpen(true)}>
          <IconLock width={14} height={14} /> Entrar com código
        </button>
      </div>

      {rooms.length > 0 && (
        <div className="lb-chips" role="tablist" aria-label="Filtrar salas por jogo">
          <button type="button" role="tab" aria-selected={filter === ''} className={`lb-chip ${filter === '' ? 'lb-chip-on' : ''}`} onClick={() => setFilter('')}>
            Todas <b>{rooms.length}</b>
          </button>
          {GAME_LIST.filter((g) => byGame[g.id]).map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={filter === g.id} className={`lb-chip ${filter === g.id ? 'lb-chip-on' : ''}`}
              style={{ '--gc': GAME_ART[g.id].color } as CSSProperties} onClick={() => setFilter(filter === g.id ? '' : g.id)}>
              <i className="lb-chip-ico">{GAME_ART[g.id].icon}</i>{GAME_SHORT[g.id]} <b>{byGame[g.id]}</b>
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyRooms game={filter || null} onCreate={() => setCreating(filter || null)} onCode={() => setCodeOpen(true)} />
      ) : (
        <>
          {open.length > 0 && (
            <section>
              <h3 className="lb-sub"><span className="lb-dot" /> Abertas para entrar <b>{open.length}</b></h3>
              <div className="lb-grid">{open.map((r) => <RoomCard key={r.id} room={r} />)}</div>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <h3 className="lb-sub">{open.length > 0 ? 'Em andamento e lotadas' : 'Em andamento'} <b>{others.length}</b></h3>
              <div className="lb-grid">{others.map((r) => <RoomCard key={r.id} room={r} />)}</div>
            </section>
          )}
        </>
      )}

      {creating !== false && <CreateRoomModal onClose={() => setCreating(false)} defaultGame={creating ?? undefined} />}
      {codeOpen && <JoinCodeModal onClose={() => setCodeOpen(false)} />}
    </div>
  );
}

function EmptyRooms({ game, onCreate, onCode }: { game: GameId | null; onCreate: () => void; onCode: () => void }) {
  return (
    <div className="lb-empty">
      <div className="lb-fan" aria-hidden>
        <span className="lb-fan-card lb-fan-l">♥</span>
        <span className="lb-fan-card lb-fan-c">♠</span>
        <span className="lb-fan-card lb-fan-r">♦</span>
      </div>
      <strong>{game ? `Nenhuma sala de ${GAME_SHORT[game]} agora` : 'A mesa está vazia'}</strong>
      <span className="lb-empty-text">
        {game
          ? 'Que tal abrir a primeira? Os amigos entram pela lista ou pelo código.'
          : 'Abra uma sala e chame os amigos, ou entre na de alguém com o código.'}
      </span>
      <div className="lb-empty-actions">
        <button type="button" className="btn btn-primary" onClick={onCreate}>{game ? `Criar sala de ${GAME_SHORT[game]}` : 'Criar a primeira sala'}</button>
        <button type="button" className="btn" onClick={onCode}>Tenho um código</button>
      </div>
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
    <article className={`lb-room ${isOpen(room) ? 'lb-room-open' : ''}`} style={{ '--gc': art.color } as CSSProperties}>
      <span className="lb-ico" aria-hidden>{art.icon}</span>
      <div className="lb-room-main">
        <div className="lb-room-title">
          {room.isPrivate && <IconLock width={12} height={12} aria-label="Sala privada" />}
          <span className="lb-room-name" title={room.name}>{room.name}</span>
        </div>
        <div className="lb-room-meta">
          <span>{GAME_SHORT[room.gameId]}</span><i>·</i><span className="lb-stakes">{room.stakesLabel}</span>
        </div>
        <div className="lb-room-foot">
          <span className="lb-seats" title={`${room.seatsTaken}/${room.seatsTotal} lugares`}>
            {Array.from({ length: room.seatsTotal }, (_, i) => <i key={i} className={i < room.seatsTaken ? 'on' : ''} />)}
          </span>
          <span className="lb-seatnum">{room.seatsTaken}/{room.seatsTotal}</span>
          <span className="lb-host" title={`líder ${room.hostName}`}>· líder {room.hostName}</span>
        </div>
      </div>
      <div className="lb-room-side">
        <span className={`lb-status lb-status-${room.status}`}>{STATUS_LABEL[room.status]}</span>
        <button type="button" className={`btn btn-sm lb-join ${watch ? '' : 'btn-primary'}`} disabled={busy} onClick={() => void join()}>
          {watch ? 'Assistir' : 'Entrar'}
        </button>
      </div>
    </article>
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
        <p className="muted-text small">Peça o código ao líder da sala. Funciona também para salas privadas.</p>
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
