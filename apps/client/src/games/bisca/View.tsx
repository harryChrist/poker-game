import { useEffect, useRef, useState } from 'react';
import { SUIT_NAME_PT, SUIT_SYMBOL, isHidden, type MaybeCard } from '@cards/shared';
import type { View, Action } from '@cards/games/bisca';
import { ActionBar, Card, CardBack, CardSlot, Hand, SeatBadge, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import './View.css';

type Pos = 'bottom' | 'left' | 'top' | 'right';

function posOf(seat: number, base: number, n: number): Pos {
  const rel = (seat - base + n) % n;
  if (n === 2) return rel === 0 ? 'bottom' : 'top';
  return (['bottom', 'left', 'top', 'right'] as Pos[])[rel];
}

export default function BiscaView({ view, mySeat, turn, sendAction, room }: GameViewProps<View, Action>) {
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  const base = mySeat ?? 0;
  const n = view.n;
  const me = view.myTeam;
  const legal = view.legal;
  const turnMs = ((room.config.turnSeconds as number) ?? 20) * 1000;

  const send = async (a: Action) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendAction(a);
      if (!r.ok) {
        setErrMsg(r.error || 'Jogada não permitida.');
        if (errTimer.current) clearTimeout(errTimer.current);
        errTimer.current = setTimeout(() => setErrMsg(null), 3000);
      }
    } catch {
      setErrMsg('Falha ao enviar a jogada.');
    } finally {
      setBusy(false);
    }
  };

  const name = (seat: number | null) => (seat === null ? '' : view.players[seat]?.name ?? `Jogador ${seat + 1}`);
  const seatsBy: Record<Pos, number | null> = { bottom: null, left: null, top: null, right: null };
  for (let s = 0; s < n; s++) seatsBy[posOf(s, base, n)] = s;
  const active = turn.seats;

  const renderOpp = (pos: Pos) => {
    const seat = seatsBy[pos];
    if (seat === null) return null;
    const isPartner = n === 4 && seat % 2 === me;
    const cards: MaybeCard[] = Array.from({ length: view.handCounts[seat] ?? 0 }, () => ({ hidden: true }));
    return (
      <div className={`bisca-opp bisca-opp-${pos}`}>
        <SeatBadge name={name(seat)} isBot={view.players[seat]?.isBot} active={active.includes(seat)}
          tag={view.table.length === 0 && seat === view.leader && view.phase === 'play' ? 'Sai' : undefined}
          sub={isPartner ? 'parceiro' : undefined} deadline={active.includes(seat) ? turn.deadline : null} turnMs={turnMs} />
        <div className="bisca-opp-cards">
          {cards.map((_, i) => <CardBack key={i} size="xs" />)}
        </div>
      </div>
    );
  };

  const renderPlayed = (pos: Pos) => {
    const seat = seatsBy[pos];
    const p = view.table.find((x) => x.seat === seat);
    if (!p || seat === null) return <CardSlot size="sm" />;
    const win = view.phase === 'trickEnd' && view.lastTrick?.winnerSeat === seat;
    const mine = seat % 2 === me;
    return (
      <div className={`bisca-played ${mine ? 'bisca-played-us' : 'bisca-played-them'}`}>
        <Card card={p.card} size="sm" highlight={win} />
        <span className="bisca-played-name">{seat === mySeat ? 'Você' : name(seat)}</span>
      </div>
    );
  };

  let banner: { text: string; tone: 'info' | 'good' | 'bad' } | null = null;
  if (view.phase === 'over' && view.winnerTeam !== null) {
    banner = view.winnerTeam === me
      ? { text: `Vitória! ${view.wins[me]} a ${view.wins[1 - me]} em jogos`, tone: 'good' }
      : { text: `Derrota. ${view.wins[me]} a ${view.wins[1 - me]} em jogos`, tone: 'bad' };
  } else if ((view.phase === 'gameEnd' || view.phase === 'over') && view.gameResult) {
    const r = view.gameResult;
    banner = r.winnerTeam === null
      ? { text: `Empate: ${r.points[me]} a ${r.points[1 - me]}. O jogo não conta.`, tone: 'info' }
      : r.winnerTeam === me
        ? { text: `Vocês fizeram ${r.points[me]} a ${r.points[1 - me]}. Ganharam o jogo!`, tone: 'good' }
        : { text: `Eles fizeram ${r.points[1 - me]} a ${r.points[me]}. Perderam o jogo.`, tone: 'bad' };
  } else if (view.phase === 'trickEnd' && view.lastTrick) {
    const w = view.lastTrick.winnerSeat;
    banner = {
      text: `${w === mySeat ? 'Você' : name(w)} levou a vaza (+${view.lastTrick.points})`,
      tone: w % 2 === me && (n === 4 || w === mySeat) ? 'good' : 'info',
    };
  }

  const actions = [];
  if (legal?.canSwap) {
    actions.push({
      label: 'Trocar o 2 pelo trunfo', kind: 'primary' as const, disabled: busy,
      onClick: () => send({ type: 'swapTrump' }),
    });
  }

  const myTurn = !!legal;
  const status = myTurn ? 'Sua vez' : view.phase === 'play' ? `Vez de ${name(view.turnSeat)}` : '';
  const showPoints = view.phase === 'gameEnd' || view.phase === 'over';

  return (
    <Table className="bisca-table">
      <div className="bisca-head">
        <div className="bisca-score" aria-label="Placar">
          <span className="bisca-score-side bisca-us"><small>Nós</small><b>{view.points[me]}</b></span>
          <span className="bisca-score-x">x</span>
          <span className="bisca-score-side bisca-them"><b>{view.points[1 - me]}</b><small>Eles</small></span>
        </div>
        <div className="bisca-info">
          {view.targetWins > 1
            ? <span className="bisca-wins">Jogos {view.wins[me]} x {view.wins[1 - me]} (até {view.targetWins})</span>
            : <span className="bisca-wins">Jogo único</span>}
          <span className="bisca-goal">{showPoints ? 'pontos finais' : 'pontos (vence com +60)'}</span>
        </div>
        <div className="bisca-deck" title={`Trunfo: ${SUIT_NAME_PT[view.trumpSuit]}`}>
          <div className="bisca-stock">
            {view.stockCount > 1 && <CardBack size="xs" />}
            {view.trumpCard
              ? <span className="bisca-trump-card"><Card card={view.trumpCard} size="xs" highlight /></span>
              : <span className="bisca-trump-suit">{SUIT_SYMBOL[view.trumpSuit]}</span>}
          </div>
          <span className="bisca-deck-label">
            Trunfo {SUIT_SYMBOL[view.trumpSuit]}<br /><b>{view.stockCount}</b> no monte
          </span>
        </div>
      </div>

      <div className="bisca-board">
        <div className="bisca-area bisca-area-top">{renderOpp('top')}</div>
        {n === 4 && <div className="bisca-area bisca-area-left">{renderOpp('left')}</div>}
        <div className="bisca-center">
          <div className={`bisca-trick bisca-trick-${n}`}>
            {n === 4 && <div className="bisca-slot bisca-slot-left">{renderPlayed('left')}</div>}
            <div className="bisca-slot bisca-slot-top">{renderPlayed('top')}</div>
            {n === 4 && <div className="bisca-slot bisca-slot-right">{renderPlayed('right')}</div>}
            <div className="bisca-slot bisca-slot-bottom">{renderPlayed('bottom')}</div>
          </div>
        </div>
        {n === 4 && <div className="bisca-area bisca-area-right">{renderOpp('right')}</div>}
      </div>

      {banner && <div className={`bisca-banner bisca-banner-${banner.tone}`} role="status">{banner.text}</div>}
      {errMsg && <div className="bisca-error" role="alert">{errMsg}</div>}

      <div className="bisca-bottom">
        {mySeat !== null && (
          <SeatBadge name={name(mySeat)} isMe active={active.includes(mySeat)} deadline={active.includes(mySeat) ? turn.deadline : null}
            turnMs={turnMs} sub={status || undefined} />
        )}
        <Hand cards={view.myHand} size="md" layout="row"
          playableIds={legal ? legal.cards : undefined}
          highlightIds={view.myHand.filter((c) => c.s === view.trumpSuit).map((c) => c.id)}
          onCardClick={legal && !busy ? (card) => { if (!isHidden(card)) send({ type: 'play', cardId: card.id }); } : undefined} />
        {actions.length > 0 && <ActionBar actions={actions} />}
      </div>
    </Table>
  );
}
