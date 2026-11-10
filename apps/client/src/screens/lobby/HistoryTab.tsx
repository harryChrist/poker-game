import { useEffect, useState } from 'react';
import { GAMES, type HistoryEntry } from '@cards/shared';
import { act } from '../../net/actions';
import { fmtDateTime, fmtSigned } from '../../ui/format';
import { Empty, Spinner } from '../../ui/widgets';

export function HistoryTab() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    void act('history:get', {}).then((res) => setRows(res.ok ? res.data : []));
  }, []);

  if (!rows) return <Spinner label="Carregando histórico…" />;
  if (rows.length === 0) return <Empty>Você ainda não jogou nenhuma partida.</Empty>;
  return (
    <div className="list">
      {rows.map((h) => (
        <div key={h.id} className="room-row">
          <div className="room-row-main">
            <div className="room-row-title">
              <span className="room-name">{GAMES[h.gameId]?.name ?? h.gameId} · {h.roomName}</span>
            </div>
            <div className="room-row-meta">
              <span>{h.summary}</span>
              <span>{fmtDateTime(h.endedAt)}</span>
            </div>
          </div>
          <strong className={h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : ''}>{fmtSigned(h.net)}</strong>
        </div>
      ))}
    </div>
  );
}
