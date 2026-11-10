import { type CSSProperties } from 'react';
import { RANK_LABEL, isHidden, type MaybeCard } from '@cards/shared';
import type { Action, View } from '@cards/games/fodinha';
import { Card, CardBack, Hand, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import { Arena, type ArenaSeat } from '../_tricks/Arena';
import { useActionSender } from '../_tricks/useSend';
import './View.css';

export default function FodinhaView({ view, mySeat, room, turn, sendAction }: GameViewProps<View, Action>) {
  const { send, error } = useActionSender<Action>(sendAction);
  const myTurnPlay = view.canPlay;
  const myBet = view.bet;
  const turnMs = (room.config.turnSeconds ?? 20) * 1000;
  const inRound = view.phase === 'betting' || view.phase === 'playing' || view.phase === 'trickEnd';

  const seats: ArenaSeat[] = view.players.map((p, i) => {
    const played = view.trick.find((t) => t.seat === i);
    const alive = view.alive[i];
    const held = view.oneCard && inRound && i !== mySeat ? view.hands[i][0] : undefined;
    const bet = view.bets[i];
    return {
      seat: i,
      name: p.name,
      isBot: p.isBot,
      connected: room.seats[i]?.connected ?? true,
      tag: i === view.dealer && alive ? 'D' : undefined,
      dimmed: !alive,
      sub: !alive ? 'fora' : (
        <>
          <span>♥{view.lives[i]} · {bet === null ? '–' : bet}/{view.won[i]}</span>
          {held && !isHidden(held) && <div className="fodinha-held"><Card card={held} size="xs" /></div>}
        </>
      ),
      active: view.turn === i,
      played: played?.card ?? null,
      winner: view.phase === 'trickEnd' && view.trickWinner === i,
    };
  });

  const status = (() => {
    if (view.result) return view.result.summary;
    if (view.phase === 'betting') {
      if (myBet) return 'Sua vez: quantas vazas você vai fazer?';
      return view.turn !== null ? `${view.players[view.turn].name} está apostando…` : '';
    }
    if (view.phase === 'trickEnd') {
      return view.trickWinner !== null ? `${view.players[view.trickWinner].name} levou a vaza.` : 'Embuchou! Ninguém levou a vaza.';
    }
    if (view.phase === 'roundEnd') return 'Fim da rodada. Próxima em instantes…';
    if (myTurnPlay) return view.oneCard ? 'Sua vez: jogue a sua carta (você não a vê).' : 'Sua vez de jogar.';
    if (view.turn !== null) return `Vez de ${view.players[view.turn].name}…`;
    return '';
  })();

  const mine = view.myHand;
  const half = Math.ceil(mine.length / 2);
  const rows: MaybeCard[][] = mine.length > 10 ? [mine.slice(0, half), mine.slice(half)] : [mine];
  const manilhaIds = mine.filter((c) => !isHidden(c) && c.r === view.manilhaRank).map((c) => (c as { id: string }).id);
  const playCard = (c: MaybeCard) => { if (!isHidden(c)) void send({ type: 'play', cardId: c.id }); };
  const showPanel = view.phase === 'roundEnd' || view.phase === 'over';
  const myRowAlive = mySeat !== null && view.alive[mySeat];
  const betNumbers = myBet
    ? Array.from({ length: view.cardsPer + 1 }, (_, i) => i)
    : [];

  return (
    <Table className="tr-root fodinha">
      <div className="tr-topbar">
        <span className="tr-chip">Rodada <b>{view.round}</b> · <b>{view.cardsPer}</b> {view.cardsPer === 1 ? 'carta' : 'cartas'}</span>
        <span className="tr-chip tr-chip-accent" title="A manilha é a carta seguinte à vira">
          Vira <Card card={view.vira} size="xs" /> manilha {RANK_LABEL[view.manilhaRank]}
        </span>
      </div>

      <Arena seats={seats} mySeat={mySeat} deadline={turn.deadline} turnMs={turnMs} legend={<>♥ vidas<br />palpite/feitas</>}>
        {view.embuchou && <div className="tr-panel"><div className="tr-panel-title">Embuchou!</div>Todas as cartas se anularam.</div>}
        {showPanel && view.roundResult && (
          <div className="tr-panel">
            <div className="tr-panel-title">{view.phase === 'over' ? 'Fim da partida' : `Fim da rodada ${view.round}`}</div>
            <table>
              <thead><tr><th></th><th>Palp.</th><th>Fez</th><th>♥</th></tr></thead>
              <tbody>
                {view.roundResult.map((r) => (
                  <tr key={r.seat}>
                    <td>{view.players[r.seat].name}</td>
                    <td>{r.bet}</td>
                    <td className={r.lost === 0 ? 'tr-good' : 'tr-bad'}>{r.won}</td>
                    <td className={r.lost === 0 ? '' : 'tr-bad'}>{r.livesAfter}{r.lost > 0 ? ` (-${r.lost})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {view.result && <div style={{ marginTop: 4 }}>{view.result.summary}</div>}
          </div>
        )}
      </Arena>

      <div className="tr-bottom" style={{ '--hn': view.cardsPer > 10 ? Math.ceil(view.cardsPer / 2) : view.cardsPer } as CSSProperties}>
        {error && <div className="tr-error">{error}</div>}
        <div className={`tr-status ${myBet || myTurnPlay ? 'tr-status-me' : ''}`}>{status}</div>

        {myBet && (
          <div className="fodinha-bets">
            {betNumbers.map((n) => {
              const forbidden = n === myBet.forbidden;
              return (
                <button key={n} type="button" className="btn btn-primary fodinha-bet" disabled={forbidden}
                  title={forbidden ? `Proibido: a soma dos palpites não pode ser ${view.cardsPer}` : `Apostar ${n}`}
                  onClick={() => { void send({ type: 'bet', n }); }}>
                  {n}
                </button>
              );
            })}
          </div>
        )}
        {myBet && myBet.forbidden !== null && <div className="fodinha-note">{myBet.forbidden} está proibido (você é o pé).</div>}

        {mySeat !== null && myRowAlive && view.oneCard && inRound && mine.length > 0 && (
          <button type="button" className={`fodinha-mycard ${myTurnPlay ? 'fodinha-mycard-on' : ''}`}
            disabled={!myTurnPlay} onClick={() => { void send({ type: 'play' }); }}
            title={myTurnPlay ? 'Jogar a minha carta' : 'Sua carta (virada)'}>
            <CardBack size="lg" />
          </button>
        )}
        {mySeat !== null && !(view.oneCard && inRound) && mine.length > 0 && (
          <div className="tr-hand-rows">
            {rows.map((r, k) => (
              <Hand key={k} mine cards={r} size={rows.length > 1 ? 'sm' : 'md'} layout="fan"
                highlightIds={manilhaIds}
                onCardClick={myTurnPlay ? playCard : undefined} />
            ))}
          </div>
        )}
      </div>
    </Table>
  );
}
