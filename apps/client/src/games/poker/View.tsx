import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Action, View } from '@cards/games/poker';
import { Card, CardSlot, Chips, formatChips, Hand, SeatBadge, Table, ActionBar, type ActionButton } from '../../ui/cards';
import type { GameViewProps } from '../types';
import './View.css';

type SeatV = NonNullable<View['seats'][number]>;

/** Posição (em %) do assento k (0 = embaixo) numa mesa oval com n lugares, no sentido horário. */
function polar(k: number, n: number, rx: number, ry: number, cy = 48, scale = 1) {
  const a = ((90 + (k * 360) / n) * Math.PI) / 180;
  return { x: 50 + rx * scale * Math.cos(a), y: cy + ry * scale * Math.sin(a) };
}

function tagFor(s: SeatV): string | undefined {
  const t: string[] = [];
  if (s.isDealer) t.push('D');
  if (s.isSB) t.push('SB');
  if (s.isBB) t.push('BB');
  return t.length ? t.join('/') : undefined;
}

export default function PokerView({ view, mySeat, room, turn, sendAction }: GameViewProps<View, Action>) {
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [raiseTo, setRaiseTo] = useState(0);
  const [raiseText, setRaiseText] = useState('');
  const [busy, setBusy] = useState(false);

  const n = view.seats.length;
  const base = mySeat ?? 0;
  const legal = view.legal;
  const turnMs = (room.config.turnSeconds ?? 30) * 1000;

  const send = async (a: Action) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendAction(a);
      if (!r.ok) {
        setError(r.error ?? 'Ação recusada.');
        if (errTimer.current) clearTimeout(errTimer.current);
        errTimer.current = setTimeout(() => setError(null), 3500);
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  // valor inicial do aumento a cada nova decisão
  const resetKey = legal ? `${view.handNo}-${view.street}-${legal.toCall}-${legal.raise?.min ?? 0}` : '';
  useEffect(() => {
    if (legal?.raise) {
      setRaiseTo(legal.raise.min);
      setRaiseText(String(legal.raise.min));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const setRaise = (v: number) => {
    if (!legal?.raise) return;
    const c = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(v)));
    setRaiseTo(c);
    setRaiseText(String(c));
  };
  const onText = (t: string) => {
    setRaiseText(t.replace(/[^0-9]/g, ''));
    const v = parseInt(t, 10);
    if (Number.isFinite(v) && legal?.raise) setRaiseTo(Math.max(legal.raise.min, Math.min(legal.raise.max, v)));
  };

  const winning = view.winningIds;
  const me = mySeat !== null ? view.seats[mySeat] : null;

  const status = useMemo(() => {
    if (view.phase === 'waiting') {
      const eligible = view.seats.filter((s) => s && !s.sittingOut).length;
      return eligible < 2 ? 'Aguardando mais jogadores…' : 'Nova mão já vai começar…';
    }
    if (view.phase === 'result' && view.result) {
      const r = view.result;
      if (r.winners.length === 0) return 'Mão encerrada.';
      return r.winners.map((w) => `${w.name} ganhou ${formatChips(w.amount)}${r.showdown && w.handName ? ` — ${w.handName}` : ''}`).join(' · ');
    }
    if (view.turnSeat !== null) {
      if (view.turnSeat === mySeat) return 'Sua vez';
      return `Vez de ${view.seats[view.turnSeat]?.name ?? '…'}`;
    }
    return view.phase === 'runout' ? 'Todos all-in: abrindo as cartas…' : '';
  }, [view, mySeat]);

  const actions: ActionButton[] = [];
  if (legal) {
    actions.push({ label: 'Desistir', kind: 'danger', onClick: () => send({ type: 'fold' }), disabled: busy });
    if (legal.check) actions.push({ label: 'Check', onClick: () => send({ type: 'check' }), disabled: busy });
    else if (legal.call !== null) {
      const allIn = me !== null && legal.call >= me.stack;
      actions.push({
        label: allIn ? `All-in ${formatChips(legal.call)}` : `Pagar ${formatChips(legal.call)}`,
        kind: 'primary', onClick: () => send({ type: 'call' }), disabled: busy,
      });
    }
    if (legal.raise) {
      const isMax = raiseTo >= legal.raise.max;
      const verb = isMax ? 'All-in' : view.currentBet === 0 ? 'Apostar' : 'Aumentar para';
      actions.push({
        label: isMax ? `All-in ${formatChips(raiseTo)}` : `${verb} ${formatChips(raiseTo)}`,
        kind: 'primary', onClick: () => send({ type: 'raise', to: raiseTo }), disabled: busy,
      });
    } else if (legal.allin !== null && legal.call === null) {
      actions.push({ label: `All-in ${formatChips(legal.allin)}`, kind: 'primary', onClick: () => send({ type: 'allin' }), disabled: busy });
    }
  }

  return (
    <Table className="poker-felt">
      <div className="poker-info">
        <span>Mão #{view.handNo || '–'}</span>
        <span>Blinds {formatChips(view.smallBlind)}/{formatChips(view.bigBlind)}</span>
      </div>

      <div className="poker-table">
        <div className="poker-stage">
          <div className="poker-rail" />
          {/* centro: pote, board e status */}
          <div className="poker-center">
            <div className="poker-pot" title={view.pots.length > 1 ? view.pots.map((p, i) => `${i === 0 ? 'Principal' : `Lateral ${i}`} ${formatChips(p)}`).join(' · ') : undefined}>
              <Chips amount={view.pot} compact label="Pote" />
              {view.pots.length > 1 && (
                <span className="poker-sidepots">
                  {view.pots.map((p, i) => (
                    <span key={i}>{i === 0 ? 'Principal' : `Lateral ${i}`} {formatChips(p, true)}</span>
                  ))}
                </span>
              )}
            </div>
            <div className="poker-board">
              {Array.from({ length: 5 }, (_, i) => {
                const c = view.board[i];
                return c
                  ? <Card key={c.id} card={c} size="sm" highlight={winning.includes(c.id)}
                      dimmed={view.phase === 'result' && winning.length > 0 && !winning.includes(c.id)} />
                  : <CardSlot key={`s${i}`} size="sm" />;
              })}
            </div>
            <div className="poker-status-wrap">
              {status && (
                <div className={`poker-status ${view.phase === 'result' ? 'poker-status-result' : ''} ${view.turnSeat !== null && view.turnSeat === mySeat && view.phase !== 'result' ? 'poker-status-me' : ''}`}>{status}</div>
              )}
            </div>
          </div>

          {/* assentos */}
          {view.seats.map((s, i) => {
            if (!s) return null;
            const k = (i - base + n) % n;
            const pos = polar(k, n, 41, 35);
            const isMe = i === mySeat;
            const bottom = k === 0;
            const active = view.turnSeat === i;
            const dim = s.folded || s.sittingOut || (s.waiting && view.phase !== 'waiting');
            const winner = s.won !== undefined && s.won > 0;
            const dx = 50 - pos.x;
            const betDir = bottom ? 'me' : Math.abs(dx) < 8 ? 'b' : dx > 0 ? 'r' : 'l';
            const style: CSSProperties = bottom ? { left: '50%' } : { left: `${pos.x}%`, top: `${pos.y}%` };
            const foot = winner
              ? <div className="poker-foot poker-foot-win">+{formatChips(s.won!, true)}{s.handName ? ` · ${s.handName}` : ''}</div>
              : (s.handName && !s.folded)
                ? <div className="poker-foot">{s.handName}</div>
                : (s.last && !s.folded && view.phase !== 'result' && !s.bet)
                  ? <div className="poker-foot poker-foot-last">{s.last}</div>
                  : null;
            return (
              <div key={i} className={`poker-seat ${isMe ? 'poker-seat-me' : ''} ${bottom ? 'poker-seat-bottom' : ''} ${winner ? 'poker-seat-win' : ''}`} style={style}>
                {s.cards.length > 0 && (
                  <div className={`poker-hole ${s.folded ? 'poker-hole-folded' : ''}`}>
                    <Hand cards={s.cards} size={isMe ? 'md' : 'xs'} layout="fan" highlightIds={winning} />
                  </div>
                )}
                <SeatBadge
                  name={s.name} isBot={s.isBot} isMe={isMe} active={active} tag={tagFor(s)} dimmed={dim}
                  deadline={active ? turn.deadline : null} turnMs={turnMs}
                  sub={
                    s.folded ? 'Desistiu'
                      : s.sittingOut ? 'sem fichas'
                        : s.waiting && view.phase !== 'waiting' ? 'na próxima mão'
                          : <span><Chips amount={s.stack} compact />{s.allIn ? <b className="poker-allin"> ALL-IN</b> : null}</span>
                  }
                />
                {foot}
                {s.bet > 0 && view.phase !== 'result' && (
                  <div className={`poker-bet poker-bet-${betDir} ${pos.y < 48 ? 'poker-bet-up' : ''}`}><Chips amount={s.bet} compact /></div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="poker-actions">
        {error && <div className="poker-error" role="alert">{error}</div>}
        {legal ? (
          <>
            {legal.raise && (
              <div className="poker-raise">
                <button type="button" className="btn" onClick={() => setRaise(legal.raise!.half)}>½ pote</button>
                <button type="button" className="btn" onClick={() => setRaise(legal.raise!.pot)}>Pote</button>
                <button type="button" className="btn" onClick={() => setRaise(legal.raise!.max)}>All-in</button>
                <input type="range" className="poker-slider" min={legal.raise.min} max={legal.raise.max} step={1}
                  value={Math.min(Math.max(raiseTo, legal.raise.min), legal.raise.max)} onChange={(e) => setRaise(Number(e.target.value))}
                  aria-label="Valor da aposta (controle)" />
                <input className="input poker-raise-input" inputMode="numeric" value={raiseText}
                  onChange={(e) => onText(e.target.value)} onBlur={() => setRaise(raiseTo)} aria-label="Valor da aposta" />
              </div>
            )}
            <ActionBar actions={actions} />
          </>
        ) : (
          <div className="poker-wait">
            {mySeat === null ? 'Você está assistindo.'
              : me?.sittingOut ? 'Você está sem fichas. Adicione fichas para voltar.'
                : me?.waiting && view.phase !== 'waiting' ? 'Você entra na próxima mão.'
                  : me?.folded && view.phase !== 'result' ? 'Você desistiu desta mão.'
                    : view.phase === 'betting' ? 'Aguarde a sua vez…' : ' '}
          </div>
        )}
      </div>
    </Table>
  );
}
