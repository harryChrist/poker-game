import { type CSSProperties, type ReactNode } from 'react';
import { Card, SeatBadge, type CardSize } from '../../ui/cards';
import type { MaybeCard } from '@cards/shared';
import './tricks.css';

export interface ArenaSeat {
  seat: number;
  name: string;
  isBot?: boolean;
  connected?: boolean;
  tag?: string;
  sub?: ReactNode;
  active?: boolean;
  dimmed?: boolean;
  /** Carta jogada na vaza atual (aparece em frente ao jogador) */
  played?: MaybeCard | null;
  /** Destaca a carta (vencedor da vaza) */
  winner?: boolean;
}

interface ArenaProps {
  seats: ArenaSeat[];
  mySeat: number | null;
  deadline: number | null;
  turnMs: number;
  /** Conteúdo sobreposto ao centro (resultado da mão, mensagens) */
  children?: ReactNode;
  /** Conteúdo fixo no canto superior esquerdo da mesa (ex.: trunfo, vira) */
  corner?: ReactNode;
  /** Legenda pequena no canto inferior esquerdo da mesa */
  legend?: ReactNode;
}

/** Posições (x,y em %) para janelas estreitas com muitos jogadores, indexadas por `rel` (0 = eu) */
const NARROW: Record<number, [number, number][]> = {
  7: [[50, 90], [21, 80], [11, 48], [30, 15], [70, 15], [89, 48], [79, 80]],
  8: [[50, 90], [21, 81], [11, 50], [19, 17], [50, 12], [81, 17], [89, 50], [79, 81]],
};

/** posição (em %) de quem está `rel` posições (sentido horário) à esquerda de mim, em uma elipse */
function pos(rel: number, n: number, rx: number, ry: number, narrow?: [number, number], cy = 50): CSSProperties {
  const phi = (2 * Math.PI * rel) / n;
  const st: Record<string, string> = { '--x': `${50 - rx * Math.sin(phi)}%`, '--y': `${cy + ry * Math.cos(phi)}%` };
  if (narrow) { st['--xn'] = `${narrow[0]}%`; st['--yn'] = `${narrow[1]}%`; }
  return st as CSSProperties;
}

const playedStyle = { '--w': 'var(--tr-played)' } as CSSProperties;

/** Jogadores em volta da mesa (usuário embaixo) e a vaza no centro, cada carta em frente a quem jogou. */
export function Arena({ seats, mySeat, deadline, turnMs, children, corner, legend }: ArenaProps) {
  const n = seats.length;
  const base = mySeat ?? 0;
  const cardSize: CardSize = n <= 4 ? 'sm' : 'xs';
  return (
    <div className={`tr-arena ${n > 4 ? 'tr-many' : ''}`}>
      {corner && <div className="tr-corner">{corner}</div>}
      {legend && <div className="tr-legend">{legend}</div>}
      {seats.map((s) => {
        const rel = (s.seat - base + n) % n;
        return (
          <div key={`s${s.seat}`} className="tr-seat" style={pos(rel, n, 38, 40, NARROW[n]?.[rel])}>
            <SeatBadge
              name={s.name} isBot={s.isBot} connected={s.connected ?? true} active={s.active}
              isMe={s.seat === mySeat} sub={s.sub} tag={s.tag} dimmed={s.dimmed}
              deadline={s.active ? deadline : null} turnMs={turnMs}
            />
          </div>
        );
      })}
      {seats.map((s) => {
        if (!s.played) return null;
        const rel = (s.seat - base + n) % n;
        return (
          <div key={`c${s.seat}`} className="tr-played" style={pos(rel, n, n > 4 ? 24 : 19, n > 4 ? 17 : 21, undefined, n > 4 ? 46 : 50)}>
            <Card card={s.played} size={cardSize} highlight={s.winner} style={playedStyle} />
            {n > 4 && <span className={`tr-played-name ${s.winner ? 'tr-played-win' : ''}`}>{s.name}</span>}
          </div>
        );
      })}
      {children && <div className="tr-center">{children}</div>}
    </div>
  );
}
