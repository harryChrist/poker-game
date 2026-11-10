import { useEffect, useState, type CSSProperties } from 'react';
import type { Action, PassDir, View } from '@cards/games/copas';
import { ActionBar, Hand, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import { Arena, type ArenaSeat } from '../_tricks/Arena';
import { useActionSender } from '../_tricks/useSend';
import './View.css';

const DIR_LABEL: Record<PassDir, string> = {
  left: 'para a esquerda ←',
  right: 'para a direita →',
  across: 'para o jogador da frente ↑',
  none: 'sem passe',
};

export default function CopasView({ view, mySeat, room, turn, sendAction }: GameViewProps<View, Action>) {
  const { send, error } = useActionSender<Action>(sendAction);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => { setSel([]); }, [view.handNo, view.phase]);

  const passing = view.phase === 'passing';
  const iMustPass = passing && mySeat !== null && view.myPass === null;
  const myTurn = mySeat !== null && view.phase === 'playing' && view.turn === mySeat;
  const turnMs = (room.config.turnSeconds ?? 20) * 1000;

  const seats: ArenaSeat[] = view.players.map((p, i) => {
    const played = view.trick.find((t) => t.seat === i);
    return {
      seat: i,
      name: p.name,
      isBot: p.isBot,
      connected: room.seats[i]?.connected ?? true,
      sub: passing
        ? (view.passed[i] ? '✓ pronto' : 'escolhendo…')
        : <>♥ {view.handPoints[i]} · ×{view.handCounts[i]}</>,
      active: passing ? turn.seats.includes(i) && view.passed[i] === false : view.turn === i,
      played: played?.card ?? null,
      winner: view.phase === 'trickEnd' && view.trickWinner === i,
    };
  });

  const toggle = (id: string) => {
    setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? [...cur.slice(1), id] : [...cur, id]));
  };

  const status = (() => {
    if (view.result) return view.result.summary;
    if (passing) {
      if (mySeat === null) return `Passe de cartas ${DIR_LABEL[view.passDir]}…`;
      if (view.myPass !== null) return 'Cartas escolhidas. Aguardando os outros…';
      return `Escolha 3 cartas para passar ${DIR_LABEL[view.passDir]}`;
    }
    if (view.phase === 'trickEnd' && view.trickWinner !== null) return `${view.players[view.trickWinner].name} levou a vaza.`;
    if (view.phase === 'handEnd') return 'Mão encerrada. Próxima mão em instantes…';
    if (myTurn) {
      if (view.trick.length === 0 && view.hand.length === 13) return 'Sua vez: saia com o 2 de paus.';
      return view.trick.length === 0 ? 'Sua vez: escolha a carta de saída.' : 'Sua vez de jogar.';
    }
    if (view.turn !== null) return `Vez de ${view.players[view.turn].name}…`;
    return '';
  })();

  const hr = view.handResult;
  const showPanel = view.phase === 'handEnd' || view.phase === 'over';
  const lowest = Math.min(...view.scores);

  return (
    <Table className="tr-root copas">
      <div className="tr-topbar copas-score">
        {view.players.map((p, i) => (
          <span key={i} className={`tr-chip ${view.scores[i] === lowest ? 'copas-lead' : ''}`} title={`${p.name}: ${view.scores[i]} pontos`}>
            <span className="copas-name">{p.name}</span>
            <b>{view.scores[i]}</b>
            {!passing && view.handPoints[i] > 0 && <span className="tr-bad">+{view.handPoints[i]}</span>}
            {view.queenBy === i && <span title="Levou a dama de espadas">♠Q</span>}
          </span>
        ))}
        <span className="copas-info">
          Até {view.endScore} · {view.heartsBroken ? <span className="tr-bad">♥ quebradas</span> : '♥ fechadas'}
        </span>
      </div>

      <Arena seats={seats} mySeat={mySeat} deadline={turn.deadline} turnMs={turnMs}>
        {passing && (
          <div className="tr-panel tr-pass-note">
            <div className="tr-panel-title">Passe {DIR_LABEL[view.passDir]}</div>
            <div>Escolha 3 cartas. Elas só são reveladas quando todos passarem.</div>
          </div>
        )}
        {showPanel && hr && (
          <div className="tr-panel">
            <div className="tr-panel-title">{view.phase === 'over' ? 'Fim da partida' : 'Fim da mão'}</div>
            {hr.shooter !== null && <div className="tr-good">{view.players[hr.shooter].name} fechou o jogo! Os outros recebem 26.</div>}
            <table>
              <thead><tr><th></th><th>Mão</th><th>Total</th></tr></thead>
              <tbody>
                {view.players.map((p, i) => (
                  <tr key={i}><td>{p.name}</td><td className={hr.points[i] > 0 ? 'tr-bad' : 'tr-good'}>+{hr.points[i]}</td><td><b>{hr.scores[i]}</b></td></tr>
                ))}
              </tbody>
            </table>
            {view.result && <div style={{ marginTop: 4 }}>{view.result.summary}</div>}
          </div>
        )}
      </Arena>

      <div className="tr-bottom" style={{ '--hn': 13 } as CSSProperties}>
        {error && <div className="tr-error">{error}</div>}
        <div className={`tr-status ${myTurn || iMustPass ? 'tr-status-me' : ''}`}>{status}</div>
        {iMustPass && (
          <ActionBar actions={[{
            label: sel.length === 3 ? 'Passar as 3 cartas' : `Escolha ${3 - sel.length} ${3 - sel.length === 1 ? 'carta' : 'cartas'} (${sel.length}/3)`, kind: 'primary', disabled: sel.length !== 3,
            onClick: () => { void send({ type: 'pass', cardIds: sel }); },
          }]} />
        )}
        {mySeat !== null && (
          <Hand
            mine
            cards={view.hand}
            size="md"
            layout="fan"
            selectedIds={passing ? (view.myPass ?? sel) : undefined}
            highlightIds={!passing ? view.received : undefined}
            playableIds={myTurn ? view.legal ?? [] : undefined}
            onCardClick={iMustPass
              ? (c) => { if ('id' in c && c.id) toggle(c.id); }
              : myTurn ? (c) => { if ('id' in c && c.id) void send({ type: 'play', cardId: c.id }); } : undefined}
          />
        )}
      </div>
    </Table>
  );
}
