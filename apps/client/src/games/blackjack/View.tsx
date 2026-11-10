import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Action, View } from '@cards/games/blackjack';
import { Card, Chips, formatChips, Hand, SeatBadge, Table, ActionBar, type ActionButton } from '../../ui/cards';
import type { GameViewProps } from '../types';
import './View.css';

type SeatV = NonNullable<View['seats'][number]>;
type HandV = SeatV['hands'][number];

const OUTCOME_LABEL: Record<NonNullable<HandV['outcome']>, string> = {
  win: 'Ganhou', lose: 'Perdeu', push: 'Empate', blackjack: 'Blackjack!', bust: 'Estourou',
};

function signed(n: number): string {
  return n > 0 ? `+${formatChips(n)}` : n < 0 ? `-${formatChips(-n)}` : '0';
}

/** Posição (em %) do assento k (0 = embaixo) numa mesa oval com n lugares, no sentido horário. */
function polar(k: number, n: number, rx: number, ry: number, cy: number) {
  const a = ((90 + (k * 360) / n) * Math.PI) / 180;
  return { x: 50 + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

function HandBlock({ h, mine, showResult }: { h: HandV; mine: boolean; showResult: boolean }) {
  const cls = [
    'bj-hand', h.active && 'bj-hand-active', h.bust && 'bj-hand-bust',
    showResult && h.outcome && `bj-hand-${h.outcome}`,
  ].filter(Boolean).join(' ');
  // no resultado, "estourou"/"blackjack" já aparecem na etiqueta de desfecho: não repete o total
  const hideTotal = showResult && (h.outcome === 'bust' || h.outcome === 'blackjack');
  return (
    <div className={cls}>
      <Hand cards={h.cards} size={mine ? 'md' : 'xs'} layout="fan" />
      <div className="bj-hand-info">
        {!hideTotal && <span className={`bj-total ${h.isBlackjack ? 'bj-total-bj' : ''} ${h.bust ? 'bj-total-bust' : ''}`}>{h.label}</span>}
        <span className="bj-bet"><Chips amount={h.bet} compact />{h.doubled ? <i title="dobrada"> ×2</i> : null}</span>
      </div>
      {showResult && h.outcome && (
        <div className={`bj-outcome bj-outcome-${h.outcome}`}>
          {OUTCOME_LABEL[h.outcome]}{h.net !== null && h.outcome !== 'push' ? ` ${signed(h.net)}` : ''}
        </div>
      )}
    </div>
  );
}

export default function BlackjackView({ view, mySeat, room, turn, sendAction }: GameViewProps<View, Action>) {
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const legal = view.legal;
  const me = mySeat !== null ? view.seats[mySeat] : null;
  const turnMs = (room.config.turnSeconds ?? 20) * 1000;

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

  // valor inicial da aposta a cada rodada
  useEffect(() => {
    if (legal?.phase === 'betting') {
      const v = legal.lastBet >= legal.minBet ? Math.min(legal.lastBet, legal.maxBet) : legal.minBet;
      setAmount(String(v));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.round, legal?.phase === 'betting']);

  const n = view.seats.length;
  const base = mySeat ?? 0;
  const result = view.phase === 'result';
  const present = view.seats.filter(Boolean).length;

  const bet = Math.floor(Number(amount) || 0);
  const quick = (mult: number) => {
    if (!legal) return;
    setAmount(String(Math.min(legal.maxBet, legal.minBet * mult)));
  };

  const status = (() => {
    switch (view.phase) {
      case 'waiting': return view.seats.some((s) => s && !s.sittingOut) ? 'Abrindo apostas…' : 'Aguardando jogadores com fichas…';
      case 'betting': return me?.decided ? 'Aposta feita. Aguardando os outros…' : 'Faça sua aposta';
      case 'insurance': return view.dealer.cards.length ? 'A banca mostra um Ás: seguro?' : '';
      case 'playing': {
        if (!view.toAct) return '';
        if (view.toAct.seat === mySeat) return 'Sua vez';
        return `Vez de ${view.seats[view.toAct.seat]?.name ?? '…'}`;
      }
      case 'dealer': return 'Vez da banca';
      case 'result': return me && me.net !== null ? (me.net > 0 ? `Você ganhou ${formatChips(me.net)}!` : me.net < 0 ? `Você perdeu ${formatChips(-me.net)}` : 'Empate') : 'Fim da rodada';
    }
  })();

  const buttons: ActionButton[] = [];
  if (legal?.phase === 'playing') {
    buttons.push({ label: 'Pedir', kind: 'primary', onClick: () => send({ type: 'hit' }), disabled: busy || !legal.hit });
    buttons.push({ label: 'Parar', onClick: () => send({ type: 'stand' }), disabled: busy });
    buttons.push({ label: 'Dobrar', onClick: () => send({ type: 'double' }), disabled: busy || !legal.double });
    buttons.push({ label: 'Dividir', onClick: () => send({ type: 'split' }), disabled: busy || !legal.split });
  } else if (legal?.phase === 'insurance') {
    buttons.push({ label: `Seguro (${formatChips(legal.insuranceCost)})`, kind: 'primary', onClick: () => send({ type: 'insurance', take: true }), disabled: busy });
    buttons.push({ label: 'Sem seguro', onClick: () => send({ type: 'insurance', take: false }), disabled: busy });
  }

  const renderSeat = (s: SeatV, i: number) => {
    const k = (i - base + n) % n;
    const isMe = i === mySeat;
    const bottom = k === 0;
    const pos = polar(k, n, 41, 35, 48); // mesma geometria do poker
    const active = view.turnSeats.includes(s.seat);
    const style: CSSProperties = bottom ? { left: '50%' } : { left: `${pos.x}%`, top: `${pos.y}%` };
    const multi = s.hands.length > 1;
    const hands = s.hands.length > 0 ? (
      <div className={`bj-hands ${multi ? 'bj-multi' : ''}`}>
        {s.hands.map((h, hi) => <HandBlock key={hi} h={h} mine={isMe} showResult={result} />)}
      </div>
    ) : (
      view.phase === 'betting' && s.decided && s.betPlaced > 0
        ? <div className="bj-placed"><Chips amount={s.betPlaced} compact /></div>
        : <div className="bj-placed bj-placed-empty">
          {view.phase === 'betting' ? (s.decided ? 'pulou' : s.sittingOut ? '' : 'apostando…') : s.sittingOut ? 'sem fichas' : view.phase !== 'waiting' ? 'aguardando' : ''}
        </div>
    );
    return (
      <div key={i} className={`bj-seat ${isMe ? 'bj-seat-me' : ''} ${bottom ? 'bj-seat-bottom' : ''}`} style={style}>
        {hands}
        {s.insurance > 0 && <div className="bj-ins">Seguro {formatChips(s.insurance, true)}</div>}
        <SeatBadge
          name={s.name} isBot={s.isBot} isMe={isMe} active={active} dimmed={s.sittingOut}
          deadline={active ? turn.deadline : null} turnMs={turnMs}
          sub={<span><Chips amount={s.stack} compact />{result && multi && s.net !== null && s.net !== 0 ? <b className={s.net > 0 ? 'bj-up' : 'bj-down'}> {signed(s.net)}</b> : null}</span>}
        />
      </div>
    );
  };


  return (
    <Table className="bj-felt">
      <div className="bj-info">
        <span>Rodada {view.round || '–'}</span>
        <span>Aposta {formatChips(view.minBet)}–{formatChips(view.maxBet, true)}</span>
      </div>

      <div className="bj-table">
        <div className={`bj-stage bj-n${Math.min(present, 7)}`}>
          <div className="bj-rail" />
          <div className="bj-dealer">
            <div className="bj-dealer-name">
              <span>Banca</span>
              {view.dealer.label ? <span className={`bj-total ${view.dealer.isBlackjack ? 'bj-total-bj' : ''} ${view.dealer.bust ? 'bj-total-bust' : ''}`}>{view.dealer.label}</span> : null}
            </div>
            <div className="bj-dealer-cards">
              {view.dealer.cards.length > 0
                ? <Hand cards={view.dealer.cards} size="sm" layout="fan" />
                : <Card card={{ hidden: true }} size="sm" style={{ opacity: 0.18 }} />}
              <div className="bj-shoe" title={`Cartas restantes no sapato: ${view.shoePct}%`}>
                <span className="bj-shoe-stack"><i /><i /><i /></span>
                <span className="bj-shoe-pct">{view.shoePct}%</span>
              </div>
            </div>
            <div className="bj-status-wrap">
              {status && <div className={`bj-status ${result ? 'bj-status-result' : ''} ${view.toAct && view.toAct.seat === mySeat && view.phase === 'playing' ? 'bj-status-me' : ''}`}>{status}</div>}
            </div>
          </div>

          {view.seats.map((s, i) => (s ? renderSeat(s, i) : null))}
        </div>
      </div>

      <div className="bj-actions">
        {error && <div className="bj-error" role="alert">{error}</div>}
        {legal?.phase === 'betting' ? (
          <div className="bj-betbox">
            <div className="bj-quick">
              <button type="button" className="btn" onClick={() => quick(1)} disabled={legal.minBet > legal.maxBet}>{formatChips(legal.minBet, true)}</button>
              {[2, 5, 10].map((m) => (
                <button key={m} type="button" className="btn" onClick={() => quick(m)} disabled={legal.minBet * m > legal.maxBet && legal.minBet * m > (me?.stack ?? 0)}>×{m}</button>
              ))}
              {legal.lastBet >= legal.minBet && (
                <button type="button" className="btn" onClick={() => setAmount(String(Math.min(legal.lastBet, legal.maxBet)))}>Repetir {formatChips(Math.min(legal.lastBet, legal.maxBet), true)}</button>
              )}
              <button type="button" className="btn" onClick={() => setAmount(String(legal.maxBet))}>Máx</button>
            </div>
            <div className="bj-quick">
              <input className="input bj-amount" inputMode="numeric" value={amount} aria-label="Valor da aposta"
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && bet >= legal.minBet) send({ type: 'bet', amount: bet }); }} />
              <button type="button" className="btn btn-primary" disabled={busy || bet < legal.minBet || bet > legal.maxBet}
                onClick={() => send({ type: 'bet', amount: bet })}>Apostar {bet > 0 ? formatChips(bet) : ''}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => send({ type: 'skip' })}>Pular</button>
            </div>
          </div>
        ) : buttons.length > 0 ? (
          <ActionBar actions={buttons} />
        ) : (
          <div className="bj-wait">
            {mySeat === null ? 'Você está assistindo.'
              : me?.sittingOut ? 'Você está sem fichas para a aposta mínima. Adicione fichas.'
                : view.phase === 'betting' && me?.decided ? 'Aguardando os outros jogadores…'
                  : !me?.inRound && view.phase !== 'waiting' && view.phase !== 'betting' ? 'Você joga na próxima rodada.' : ' '}
          </div>
        )}
      </div>
    </Table>
  );
}
