import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { GAMES, type HistoryEntry } from '@cards/shared';
import { act } from '../../net/actions';
import { fmtSigned, fmtTime } from '../../ui/format';
import { GAME_ART, GAME_SHORT } from '../../ui/gameArt';
import { Spinner } from '../../ui/widgets';

const startOfDay = (ts: number) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

function dayLabel(day: number): string {
  const diff = Math.round((startOfDay(Date.now()) - day) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const s = new Date(day).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.,', ',');
}

const tone = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

export function HistoryTab() {
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    void act('history:get', {}).then((res) => setRows(res.ok ? res.data : []));
  }, []);

  const groups = useMemo(() => {
    const m = new Map<number, HistoryEntry[]>();
    for (const h of [...(rows ?? [])].sort((a, b) => b.endedAt - a.endedAt)) {
      const k = startOfDay(h.endedAt);
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()].map(([day, items]) => ({ day, items, net: items.reduce((s, h) => s + h.net, 0) }));
  }, [rows]);

  if (!rows) return <Spinner label="Carregando histórico…" />;
  if (rows.length === 0) {
    return (
      <div className="lb-empty">
        <div className="lb-fan" aria-hidden><span className="lb-fan-card lb-fan-c">♣</span></div>
        <strong>Nada por aqui ainda</strong>
        <span className="lb-empty-text">As partidas e mãos que você jogar aparecem aqui, com o resultado de cada uma.</span>
      </div>
    );
  }
  const total = rows.reduce((s, h) => s + h.net, 0);
  const wins = rows.filter((h) => h.net > 0).length;
  return (
    <div className="lb-hist">
      <div className="lb-hsum">
        <div><span>Resultado</span><strong className={tone(total)}>{fmtSigned(total)}</strong></div>
        <div><span>Jogadas</span><strong>{rows.length}</strong></div>
        <div><span>Vitórias</span><strong>{wins}</strong></div>
      </div>
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="lb-day"><span>{dayLabel(g.day)}</span><b className={tone(g.net)}>{fmtSigned(g.net)}</b></h3>
          <div className="lb-hlist">
            {g.items.map((h) => (
              <div key={h.id} className="lb-hrow" style={{ '--gc': GAME_ART[h.gameId]?.color } as CSSProperties}>
                <span className="lb-ico lb-ico-sm" aria-hidden>{GAME_ART[h.gameId]?.icon}</span>
                <div className="lb-hmain">
                  <span className="lb-hname" title={h.roomName}>{h.roomName} <i>{GAME_SHORT[h.gameId] ?? GAMES[h.gameId]?.name ?? h.gameId}</i></span>
                  <span className="lb-hsub">{h.summary}</span>
                </div>
                <div className="lb-hnet">
                  <strong className={tone(h.net)}>{fmtSigned(h.net)}</strong>
                  <span>{fmtTime(h.endedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
