import { useCallback, useEffect, useState } from 'react';
import type { RankingEntry } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { fmtInt } from '../../ui/format';
import { IconCrown, IconRefresh } from '../../ui/icons';
import { Spinner } from '../../ui/widgets';

const pct = (r: RankingEntry) => (r.played ? Math.round((r.wins / r.played) * 100) + '%' : '–');

export function RankingTab() {
  const meId = useStore((s) => s.me?.id);
  const [rows, setRows] = useState<RankingEntry[] | null>(null);

  const load = useCallback(async () => {
    const res = await act('ranking:get', {});
    setRows(res.ok ? res.data : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!rows) return <Spinner label="Carregando ranking…" />;

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  // ordem visual do pódio: 2º, 1º, 3º
  const order = [podium[1], podium[0], podium[2]].map((r, i) => (r ? { r, place: [2, 1, 3][i] } : null));
  const myPos = rows.findIndex((r) => r.userId === meId);

  return (
    <div className="lb-rank">
      <div className="lb-sectionbar">
        <h2 className="lb-h">Ranking</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()} title="Atualizar"><IconRefresh /> Atualizar</button>
      </div>

      {rows.length === 0 ? (
        <div className="lb-empty">
          <div className="lb-fan" aria-hidden><span className="lb-fan-card lb-fan-c">♠</span></div>
          <strong>Ninguém no ranking ainda</strong>
          <span className="lb-empty-text">Jogue uma partida para entrar na disputa.</span>
        </div>
      ) : (
        <>
          <div className="lb-podium">
            {order.map((o, i) => o ? (
              <div key={o.r.userId} className={`lb-pod lb-pod-${o.place} ${o.r.userId === meId ? 'lb-pod-me' : ''}`}>
                <div className="lb-pod-avatar">
                  {o.place === 1 && <IconCrown className="lb-pod-crown" width={18} height={18} />}
                  <span>{o.r.username.slice(0, 1).toUpperCase()}</span>
                </div>
                <strong className="lb-pod-name" title={o.r.username}>{o.r.username}</strong>
                <span className="lb-pod-total">{fmtInt(o.r.total)}</span>
                <span className="lb-pod-rec"><b className="pos">{o.r.wins}V</b> <b className="neg">{o.r.played - o.r.wins}D</b></span>
                <div className="lb-pod-step">{o.place}º</div>
              </div>
            ) : <div key={`e${i}`} className="lb-pod lb-pod-empty" />)}
          </div>

          {rest.length > 0 && (
            <div className="lb-ranklist">
              <div className="lb-rrow lb-rhead">
                <span>#</span><span>Jogador</span><span className="lb-r-num">Fichas</span>
                <span className="lb-r-num" title="Vitórias">V</span><span className="lb-r-num" title="Derrotas">D</span><span className="lb-r-num lb-r-opt" title="Aproveitamento">%</span>
              </div>
              {rest.map((r, i) => (
                <div key={r.userId} className={`lb-rrow ${r.userId === meId ? 'lb-rrow-me' : ''}`}>
                  <span className="lb-r-pos">{i + 4}</span>
                  <span className="lb-r-name" title={r.username}>{r.username}{r.userId === meId && <em> você</em>}</span>
                  <span className="lb-r-num">{fmtInt(r.total)}</span>
                  <span className="lb-r-num pos">{r.wins}</span>
                  <span className="lb-r-num neg">{r.played - r.wins}</span>
                  <span className="lb-r-num lb-r-opt">{pct(r)}</span>
                </div>
              ))}
            </div>
          )}
          {myPos >= 0 && <p className="lb-rank-me">Você está em <b>{myPos + 1}º</b> de {rows.length} · aproveitamento {pct(rows[myPos])}</p>}
        </>
      )}
    </div>
  );
}
