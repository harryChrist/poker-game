import { useState } from 'react';
import { GAMES, type RoomState } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { Chips } from '../../ui/cards';
import { Modal } from '../../ui/Modal';

/* ------------------------------------------------------------------ */
/* Jogos session: sentar / levantar / fichas / bots                    */
/* ------------------------------------------------------------------ */

export function SessionBar({ room, mySeat, isHost }: { room: RoomState; mySeat: number | null; isHost: boolean }) {
  const [buyIn, setBuyIn] = useState<{ mode: 'sit'; seat: number } | { mode: 'add' } | null>(null);
  const [botsOpen, setBotsOpen] = useState(false);
  const free = room.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);

  return (
    <div className="room-bar">
      {mySeat === null ? (
        <>
          <span className="room-bar-label">Lugares livres:</span>
          <div className="seat-chips">
            {free.length === 0 && <span className="muted-text">mesa cheia</span>}
            {free.map((i) => (
              <button key={i} type="button" className="btn btn-sm" onClick={() => setBuyIn({ mode: 'sit', seat: i })}>
                {i + 1}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <span className="room-bar-label">Lugar {mySeat + 1}</span>
          <button type="button" className="btn btn-sm" onClick={() => setBuyIn({ mode: 'add' })}>+ Fichas</button>
          <button type="button" className="btn btn-sm" onClick={() => void act('room:stand', {})}>Levantar</button>
        </>
      )}
      {isHost && <button type="button" className="btn btn-sm btn-ghost bar-end" onClick={() => setBotsOpen(true)}>Bots</button>}

      {buyIn && <BuyInModal room={room} state={buyIn} onClose={() => setBuyIn(null)} />}
      {botsOpen && <BotsModal room={room} onClose={() => setBotsOpen(false)} />}
    </div>
  );
}

function BuyInModal({ room, state, onClose }: { room: RoomState; state: { mode: 'sit'; seat: number } | { mode: 'add' }; onClose: () => void }) {
  const balance = useStore((s) => s.me?.balance ?? 0);
  const adding = state.mode === 'add';
  const cfgMin = adding ? 1 : room.config.minBuyIn ?? 1;
  const cfgMax = room.config.maxBuyIn ?? balance;
  const max = Math.min(cfgMax, balance);
  const min = Math.min(cfgMin, max);
  const insufficient = balance < cfgMin;
  const [amount, setAmount] = useState(String(Math.max(min, Math.min(max, adding ? Math.min(max, 1000) : min))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.floor(Number(amount));
  const valid = Number.isFinite(n) && n >= min && n <= max && !insufficient;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = state.mode === 'sit'
      ? await act('room:sit', { seat: state.seat, buyIn: n }, { silent: true })
      : await act('room:addChips', { amount: n }, { silent: true });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onClose();
  };

  return (
    <Modal title={adding ? 'Adicionar fichas' : `Sentar no lugar ${state.mode === 'sit' ? state.seat + 1 : ''}`} onClose={onClose} width={360}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {adding ? 'Adicionar' : 'Sentar'}
        </button>
      </>}>
      <div className="stack">
        <div className="between"><span className="muted-text">Seu saldo</span><Chips amount={balance} /></div>
        {insufficient ? (
          <div className="banner banner-warn">Saldo insuficiente: a entrada mínima é {cfgMin.toLocaleString('pt-BR')} fichas.</div>
        ) : (
          <>
            <label className="field">
              <span className="label">Fichas ({min.toLocaleString('pt-BR')} a {max.toLocaleString('pt-BR')})</span>
              <input className="input" type="number" min={min} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </label>
            {max > min && (
              <input type="range" min={min} max={max} step={Math.max(1, Math.round((max - min) / 100))}
                value={Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min} onChange={(e) => setAmount(e.target.value)} />
            )}
            <div className="row-center">
              <button type="button" className="btn btn-sm" onClick={() => setAmount(String(min))}>Mín</button>
              <button type="button" className="btn btn-sm" onClick={() => setAmount(String(Math.round((min + max) / 2)))}>Meio</button>
              <button type="button" className="btn btn-sm" onClick={() => setAmount(String(max))}>Máx</button>
            </div>
          </>
        )}
        {error && <div className="banner banner-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Host: adicionar/remover bots por assento */
export function BotsModal({ room, onClose }: { room: RoomState; onClose: () => void }) {
  return (
    <Modal title="Bots" onClose={onClose} width={340}>
      <div className="list">
        {room.seats.map((s, i) => (
          <div key={i} className="room-row">
            <div className="room-row-main">
              <div className="room-row-title"><span className="room-name">Lugar {i + 1}</span></div>
              <div className="room-row-meta"><span>{s ? `${s.isBot ? '🤖 ' : ''}${s.name}` : 'vazio'}</span></div>
            </div>
            {!s && <button type="button" className="btn btn-sm" onClick={() => void act('room:addBot', { seat: i })}>+ Bot</button>}
            {s?.isBot && <button type="button" className="btn btn-sm btn-danger" onClick={() => void act('room:removeBot', { seat: i })}>Remover</button>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Jogos match: resultado da última partida                            */
/* ------------------------------------------------------------------ */

export function MatchResultBar({ room, isHost }: { room: RoomState; isHost: boolean }) {
  const [busy, setBusy] = useState(false);
  const r = room.lastResult;
  const winners = r ? r.winners.map((i) => room.seats[i]?.name).filter(Boolean).join(', ') : '';
  const again = async () => {
    setBusy(true);
    await act('room:start', {});
    setBusy(false);
  };
  return (
    <div className="room-bar room-bar-result">
      <div className="result-text">
        <strong>{r?.summary ?? 'Partida encerrada.'}</strong>
        {r && winners && <span className="muted-text">Vencedor(es): {winners}{r.payoutEach > 0 && <> · <Chips amount={r.payoutEach} compact /> cada</>}</span>}
      </div>
      {isHost
        ? <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void again()}>Jogar de novo</button>
        : <span className="muted-text small">Aguardando o host</span>}
    </div>
  );
}

export function gameName(room: RoomState): string {
  return GAMES[room.gameId].name;
}
