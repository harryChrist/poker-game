import { useMemo, type CSSProperties } from 'react';
import { SUIT_NAME_PT } from '@cards/shared';
import type { Action, View } from '@cards/games/sueca';
import { Card, Hand, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import { Arena, type ArenaSeat } from '../_tricks/Arena';
import { useActionSender } from '../_tricks/useSend';
import './View.css';

export default function SuecaView({ view, mySeat, room, turn, sendAction }: GameViewProps<View, Action>) {
  const { send, error } = useActionSender<Action>(sendAction);
  const myTurn = mySeat !== null && view.phase === 'playing' && view.turn === mySeat;
  const myTeam = view.myTeam ?? 0;
  const label = (t: number) => (view.myTeam === null ? (t === 0 ? 'Dupla A' : 'Dupla B') : t === myTeam ? 'Nós' : 'Eles');
  const turnMs = (room.config.turnSeconds ?? 20) * 1000;

  const seats: ArenaSeat[] = useMemo(() => view.players.map((p, i) => {
    const played = view.trick.find((t) => t.seat === i);
    return {
      seat: i,
      name: p.name,
      isBot: p.isBot,
      connected: room.seats[i]?.connected ?? true,
      tag: i === view.dealer ? 'D' : undefined,
      sub: `${label(i % 2)} · ×${view.hands[i].length}`,
      active: view.turn === i,
      played: played?.card ?? null,
      winner: view.phase === 'trickEnd' && view.trickWinner === i,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [view, room.seats]);

  const order = [myTeam, 1 - myTeam];
  const status = (() => {
    if (view.result) return view.result.summary;
    if (view.phase === 'trickEnd' && view.trickWinner !== null) return `${view.players[view.trickWinner].name} levou a vaza.`;
    if (view.phase === 'handEnd') return 'Mão encerrada. Próxima mão em instantes…';
    if (myTurn) return view.trick.length === 0 ? 'Sua vez: escolha a carta de saída.' : 'Sua vez de jogar.';
    if (view.turn !== null) return `Vez de ${view.players[view.turn].name}…`;
    return '';
  })();

  const trumpHolder = view.trumpHeldBy !== null ? view.players[view.trumpHeldBy].name : null;
  const hr = view.handResult;
  const showPanel = view.phase === 'handEnd' || view.phase === 'over';

  return (
    <Table className="tr-root sueca">
      <div className="tr-topbar">
        <span className="tr-chip" title="Jogos (meta: primeira dupla a chegar)">
          Jogos <b>{view.games[order[0]]}</b> x <b>{view.games[order[1]]}</b>
          <span className="sueca-muted">/{view.targetGames}</span>
        </span>
        <span className="tr-chip" title="Pontos da mão (61 ou mais ganha)">
          {label(order[0])} <b>{view.points[order[0]]}</b> x <b>{view.points[order[1]]}</b> {label(order[1])}
        </span>
        <span className="tr-chip tr-chip-accent" title={trumpHolder ? `O trunfo está na mão de ${trumpHolder}` : 'O trunfo já foi jogado'}>
          Trunfo {SUIT_NAME_PT[view.trumpSuit]}
          <span className="sueca-trump"><Card card={view.trump} size="xs" /></span>
        </span>
      </div>

      <Arena seats={seats} mySeat={mySeat} deadline={turn.deadline} turnMs={turnMs}>
        {showPanel && (
          <div className="tr-panel">
            <div className="tr-panel-title">{view.phase === 'over' ? 'Fim da partida' : 'Fim da mão'}</div>
            {hr && (
              <div>
                {label(order[0])} {hr.points[order[0]]} x {hr.points[order[1]]} {label(order[1])}
                <div className={hr.team === null ? '' : hr.team === myTeam ? 'tr-good' : 'tr-bad'}>
                  {hr.team === null ? 'Empatou: ninguém marca.' : `${label(hr.team)} ${hr.team === myTeam && view.myTeam !== null ? 'marcamos' : 'marcou'} ${hr.games} ${hr.games === 1 ? 'jogo' : 'jogos'}`}
                </div>
              </div>
            )}
            {view.result && <div style={{ marginTop: 4 }}>{view.result.summary}</div>}
          </div>
        )}
      </Arena>

      <div className="tr-bottom" style={{ '--hn': 10 } as CSSProperties}>
        {error && <div className="tr-error">{error}</div>}
        <div className={`tr-status ${myTurn ? 'tr-status-me' : ''}`}>{status}</div>
        {mySeat !== null && (
          <Hand
            mine
            cards={view.hand}
            size="md"
            layout="fan"
            playableIds={myTurn ? view.legal ?? [] : undefined}
            onCardClick={myTurn ? (c) => { if ('id' in c && c.id) void send({ type: 'play', cardId: c.id }); } : undefined}
          />
        )}
      </div>
    </Table>
  );
}
