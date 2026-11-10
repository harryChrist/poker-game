import { useCallback, useEffect, useState } from 'react';
import type { RankingEntry } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { fmtInt } from '../../ui/format';
import { IconRefresh } from '../../ui/icons';
import { Empty, Spinner } from '../../ui/widgets';

export function RankingTab() {
  const meId = useStore((s) => s.me?.id);
  const [rows, setRows] = useState<RankingEntry[] | null>(null);

  const load = useCallback(async () => {
    const res = await act('ranking:get', {});
    setRows(res.ok ? res.data : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!rows) return <Spinner label="Carregando ranking…" />;
  return (
    <div className="stack">
      <div className="toolbar toolbar-end">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()} title="Atualizar"><IconRefresh /> Atualizar</button>
      </div>
      {rows.length === 0 ? <Empty>Ranking vazio.</Empty> : (
        <div className="table">
          <div className="trow thead"><span className="c-pos">#</span><span className="c-name">Jogador</span><span className="c-num">Fichas</span><span className="c-num" title="Vitórias">V</span><span className="c-num" title="Derrotas">D</span><span className="c-num c-opt" title="Aproveitamento">%</span></div>
          {rows.map((r, i) => (
            <div key={r.userId} className={`trow ${r.userId === meId ? 'trow-me' : ''}`}>
              <span className="c-pos">{i + 1}</span>
              <span className="c-name" title={r.username}>{r.username}</span>
              <span className="c-num">{fmtInt(r.total)}</span>
              <span className="c-num pos">{r.wins}</span>
              <span className="c-num neg">{r.played - r.wins}</span>
              <span className="c-num c-opt">{r.played ? Math.round((r.wins / r.played) * 100) + '%' : '–'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
