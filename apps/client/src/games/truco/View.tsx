import { useEffect, useRef, useState } from 'react';
import { RANK_LABEL, isHidden, type MaybeCard } from '@cards/shared';
import type { View, Action } from '@cards/games/truco';
import { ActionBar, Card, CardBack, CardSlot, Hand, SeatBadge, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import './View.css';

type Pos = 'bottom' | 'left' | 'top' | 'right';

/** Posição na tela de cada assento (usuário sempre embaixo; parceiro em cima) */
function posOf(seat: number, base: number, n: number): Pos {
  const rel = (seat - base + n) % n;
  if (n === 2) return rel === 0 ? 'bottom' : 'top';
  return (['bottom', 'left', 'top', 'right'] as Pos[])[rel];
}

export default function TrucoView({ view, mySeat, turn, sendAction, room }: GameViewProps<View, Action>) {
  const [covered, setCovered] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (errTimer.current) clearTimeout(errTimer.current); }, []);

  const base = mySeat ?? 0;
  const n = view.n;
  const me = view.myTeam;
  const legal = view.legal;
  const turnMs = ((room.config.turnSeconds as number) ?? 25) * 1000;

  // volta ao normal quando a vaza muda ou deixa de ser minha vez
  useEffect(() => { if (!legal || legal.kind !== 'play' || !legal.canHide) setCovered(false); }, [legal]);

  const send = async (a: Action) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendAction(a);
      if (!r.ok) {
        setErrMsg(r.error || 'Jogada não permitida.');
        if (errTimer.current) clearTimeout(errTimer.current);
        errTimer.current = setTimeout(() => setErrMsg(null), 3000);
      } else {
        setCovered(false);
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

  const activeSeats = turn.seats;
  const myMoney = view.scores[me];
  const theirScore = view.scores[1 - me];

  const renderOpp = (pos: Pos) => {
    const seat = seatsBy[pos];
    if (seat === null) return null;
    const isPartner = n === 4 && seat % 2 === me;
    const count = view.handCounts[seat] ?? 0;
    const cards: MaybeCard[] = Array.from({ length: count }, () => ({ hidden: true }));
    return (
      <div className={`truco-opp truco-opp-${pos}`}>
        <SeatBadge name={name(seat)} isBot={view.players[seat]?.isBot} active={activeSeats.includes(seat)}
          tag={seat === view.handSeat ? 'Mão' : undefined}
          sub={isPartner ? 'parceiro' : undefined} deadline={activeSeats.includes(seat) ? turn.deadline : null} turnMs={turnMs} />
        <div className="truco-opp-cards">
          {cards.map((_, i) => <CardBack key={i} size="xs" />)}
        </div>
      </div>
    );
  };

  const playedBy = (pos: Pos) => {
    const seat = seatsBy[pos];
    if (seat === null) return null;
    return view.table.find((p) => p.seat === seat) ?? null;
  };

  const renderPlayed = (pos: Pos) => {
    const p = playedBy(pos);
    const seat = seatsBy[pos];
    if (!p || seat === null) return <CardSlot size="sm" />;
    const win = view.phase === 'trickEnd' || view.phase === 'handEnd'
      ? view.tricks[view.tricks.length - 1]?.winnerSeat === seat : false;
    const mine = seat % 2 === me;
    return (
      <div className={`truco-played ${mine ? 'truco-played-us' : 'truco-played-them'}`}>
        <Card card={p.card} size="sm" highlight={win} />
        {isHidden(p.card) && <span className="truco-covered-tag">encoberta</span>}
        <span className="truco-played-name">{seat === mySeat ? 'Você' : name(seat)}</span>
      </div>
    );
  };

  const dots = [0, 1, 2].map((i) => {
    const d = view.trickDots[i];
    return d === undefined ? '·' : d === 'me' ? '●' : d === 'opp' ? '○' : '–';
  });

  const turnName = view.phase === 'respond' || view.phase === 'decide11' ? name(view.respondSeat) : name(view.turnSeat);
  const myTurn = !!legal;

  // ----- faixa de status/aviso
  let banner: { text: string; tone: 'info' | 'alert' | 'good' | 'bad' } | null = null;
  if (view.phase === 'respond' && view.pendingValue !== null && view.requestSeat !== null) {
    const asker = name(view.requestSeat);
    const label = ({ 3: 'TRUCO', 6: 'SEIS', 9: 'NOVE', 12: 'DOZE' } as Record<number, string>)[view.pendingValue];
    const mine = view.requestSeat % 2 === me;
    banner = {
      text: mine ? `${asker} pediu ${label}! Aguardando resposta...` : `${asker} pediu ${label}!`,
      tone: mine ? 'info' : 'alert',
    };
  } else if (view.phase === 'over' && view.winnerTeam !== null) {
    banner = view.winnerTeam === me
      ? { text: `Vitória! ${view.scores[me]} a ${view.scores[1 - me]}`, tone: 'good' }
      : { text: `Derrota. ${view.scores[me]} a ${view.scores[1 - me]}`, tone: 'bad' };
  } else if ((view.phase === 'handEnd' || view.phase === 'trickEnd') && view.handResult) {
    banner = {
      text: view.handResult.text,
      tone: view.handResult.winnerTeam === null ? 'info' : view.handResult.winnerTeam === me ? 'good' : 'bad',
    };
  } else if (view.phase === 'decide11' && !myTurn) {
    banner = { text: `Mão de onze: ${name(view.respondSeat)} está decidindo...`, tone: 'info' };
  } else if (view.mode === 'ferro' && view.phase === 'play') {
    banner = { text: 'Mão de ferro: jogue sem ver as cartas!', tone: 'alert' };
  } else if (view.mode === 'onze' && view.phase === 'play') {
    banner = { text: 'Mão de onze: vale 3, sem truco', tone: 'info' };
  }

  // ----- ações
  const actions = [];
  if (legal?.kind === 'play') {
    if (legal.canTruco && legal.trucoLabel) {
      actions.push({ label: `${legal.trucoLabel}!`, kind: 'danger' as const, disabled: busy, onClick: () => send({ type: 'truco' }) });
    }
    if (legal.canHide) {
      actions.push({
        label: covered ? 'Encoberta: SIM' : 'Encoberta: não',
        kind: covered ? ('primary' as const) : ('default' as const),
        onClick: () => setCovered((v) => !v),
      });
    }
  } else if (legal?.kind === 'respond') {
    actions.push({ label: `Aceitar (${legal.pendingValue})`, kind: 'primary' as const, disabled: busy, onClick: () => send({ type: 'accept' }) });
    if (legal.canRaise && legal.raiseLabel) {
      actions.push({ label: `${legal.raiseLabel}!`, kind: 'danger' as const, disabled: busy, onClick: () => send({ type: 'raise' }) });
    }
    actions.push({ label: `Correr (-${legal.runPoints})`, disabled: busy, onClick: () => send({ type: 'run' }) });
  } else if (legal?.kind === 'decide11') {
    actions.push({ label: 'Jogar (vale 3)', kind: 'primary' as const, disabled: busy, onClick: () => send({ type: 'play11' }) });
    actions.push({ label: 'Correr (+1 p/ eles)', disabled: busy, onClick: () => send({ type: 'run11' }) });
  }

  const onCardClick = legal?.kind === 'play' && !busy
    ? (card: MaybeCard, index: number) => {
        const hidden = covered && legal.canHide ? true : undefined;
        if (legal.byIndex || isHidden(card)) send({ type: 'play', index, hidden });
        else send({ type: 'play', cardId: card.id, hidden });
      }
    : undefined;

  const manilhaIds = view.myHand.filter((c) => !isHidden(c) && c.r === view.manilha).map((c) => (isHidden(c) ? '' : c.id));
  const status = myTurn ? 'Sua vez' : view.phase === 'play' || view.phase === 'respond' ? `Vez de ${turnName}` : '';

  return (
    <Table className="truco-table">
      <div className="truco-head">
        <div className="truco-score" aria-label="Placar">
          <span className="truco-score-side truco-us"><small>Nós</small><b>{myMoney}</b></span>
          <span className="truco-score-x">x</span>
          <span className="truco-score-side truco-them"><b>{theirScore}</b><small>Eles</small></span>
        </div>
        <div className="truco-info">
          <span className={`truco-value ${view.value > 1 ? 'truco-value-hot' : ''}`}>
            Vale {view.pendingValue ? `${view.value}→${view.pendingValue}` : view.value}
          </span>
          <span className="truco-dots" title="Vazas desta mão">{dots.join(' ')}</span>
        </div>
        <div className="truco-vira" title={`Manilha: ${RANK_LABEL[view.manilha]}`}>
          <Card card={view.vira} size="xs" />
          <span className="truco-vira-label">Manilha<br /><b>{RANK_LABEL[view.manilha]}</b></span>
        </div>
      </div>

      <div className="truco-board">
        <div className="truco-area truco-area-top">{renderOpp('top')}</div>
        {n === 4 && <div className="truco-area truco-area-left">{renderOpp('left')}</div>}
        <div className="truco-center">
          <div className={`truco-trick truco-trick-${n}`}>
            {n === 4 && <div className="truco-slot truco-slot-left">{renderPlayed('left')}</div>}
            <div className="truco-slot truco-slot-top">{renderPlayed('top')}</div>
            {n === 4 && <div className="truco-slot truco-slot-right">{renderPlayed('right')}</div>}
            <div className="truco-slot truco-slot-bottom">{renderPlayed('bottom')}</div>
          </div>
        </div>
        {n === 4 && <div className="truco-area truco-area-right">{renderOpp('right')}</div>}
      </div>

      {banner && <div className={`truco-banner truco-banner-${banner.tone}`} role="status">{banner.text}</div>}
      {errMsg && <div className="truco-error" role="alert">{errMsg}</div>}

      <div className="truco-bottom">
        {view.partnerHand && (
          <div className="truco-partner">
            <span className="truco-partner-label">Cartas do parceiro</span>
            <Hand cards={view.partnerHand} size="xs" layout="row" highlightIds={view.partnerHand.filter((c) => c.r === view.manilha).map((c) => c.id)} />
          </div>
        )}
        {mySeat !== null && (
          <div className="truco-me">
            <SeatBadge name={name(mySeat)} isMe active={activeSeats.includes(mySeat)} deadline={activeSeats.includes(mySeat) ? turn.deadline : null}
              turnMs={turnMs} tag={mySeat === view.handSeat ? 'Mão' : undefined} sub={status || undefined} />
          </div>
        )}
        {legal?.kind === 'play' && legal.byIndex ? (
          <div className="hand hand-row truco-ferro">
            {view.myHand.map((_, i) => (
              <button key={i} type="button" className="truco-ferro-card" disabled={busy} aria-label={`Carta ${i + 1} (virada)`}
                onClick={() => send({ type: 'play', index: i, hidden: covered && legal.canHide ? true : undefined })}>
                <CardBack size="md" />
              </button>
            ))}
          </div>
        ) : (
          <Hand cards={view.myHand} size="md" layout="row"
            highlightIds={manilhaIds}
            playableIds={legal?.kind === 'play' ? legal.cards : undefined}
            onCardClick={onCardClick} />
        )}
        {actions.length > 0 && <ActionBar actions={actions} />}
      </div>
    </Table>
  );
}
