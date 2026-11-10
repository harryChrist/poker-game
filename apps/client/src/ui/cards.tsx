import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { RANK_LABEL, SUIT_SYMBOL, isHidden, type MaybeCard } from '@cards/shared';
import './cards.css';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface CardProps {
  card: MaybeCard;
  size?: CardSize;
  selected?: boolean;
  /** Destaque dourado (ex.: manilha, trunfo, carta vencedora) */
  highlight?: boolean;
  /** Esmaecida (ex.: carta não jogável) */
  dimmed?: boolean;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}

/** Carta desenhada em CSS. Aceita HiddenCard (mostra o verso). */
export function Card({ card, size = 'md', selected, highlight, dimmed, onClick, title, style }: CardProps) {
  if (isHidden(card)) return <CardBack size={size} style={style} />;
  const red = card.s === 'H' || card.s === 'D';
  const cls = [
    'pc', `pc-${size}`, red ? 'pc-red' : 'pc-black',
    selected && 'pc-selected', highlight && 'pc-highlight', dimmed && 'pc-dimmed', onClick && 'pc-clickable',
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={!onClick} title={title} style={style}
      aria-label={`${RANK_LABEL[card.r]} de ${card.s}`}>
      <span className="pc-corner">
        <span className="pc-rank">{RANK_LABEL[card.r]}</span>
        <span className="pc-suit-sm">{SUIT_SYMBOL[card.s]}</span>
      </span>
      <span className="pc-center">{SUIT_SYMBOL[card.s]}</span>
    </button>
  );
}

export function CardBack({ size = 'md', style }: { size?: CardSize; style?: CSSProperties }) {
  return <span className={`pc pc-${size} pc-back`} style={style} aria-label="carta virada" />;
}

/** Espaço vazio do tamanho de uma carta (ex.: lugar da carta na mesa) */
export function CardSlot({ size = 'md', label }: { size?: CardSize; label?: string }) {
  return <span className={`pc pc-${size} pc-slot`}>{label}</span>;
}

interface HandProps {
  cards: MaybeCard[];
  size?: CardSize;
  /** Sobreposição: 'fan' sobrepõe as cartas (mão grande), 'row' lado a lado */
  layout?: 'fan' | 'row';
  selectedIds?: string[];
  highlightIds?: string[];
  /** ids clicáveis; se omitido e onCardClick existir, todas são clicáveis */
  playableIds?: string[];
  onCardClick?: (card: MaybeCard, index: number) => void;
}

/** Mão de cartas. Em 'fan', as cartas se sobrepõem para caber em janelas estreitas. */
export function Hand({ cards, size = 'md', layout = 'fan', selectedIds, highlightIds, playableIds, onCardClick }: HandProps) {
  return (
    <div className={`hand hand-${layout}`} style={{ '--n': cards.length } as CSSProperties}>
      {cards.map((c, i) => {
        const id = isHidden(c) ? undefined : c.id;
        const playable = onCardClick && (!playableIds || (id !== undefined && playableIds.includes(id)));
        return (
          <Card key={id ?? `h${i}`} card={c} size={size} style={{ '--i': i } as CSSProperties}
            selected={id !== undefined && selectedIds?.includes(id)}
            highlight={id !== undefined && highlightIds?.includes(id)}
            dimmed={!!onCardClick && !!playableIds && !playable}
            onClick={playable ? () => onCardClick!(c, i) : undefined} />
        );
      })}
    </div>
  );
}

/** Formata fichas: 1234 -> "1.234", 15300 -> "15,3k" quando compact */
export function formatChips(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 10_000) {
    const k = n / 1000;
    return `${k.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  }
  return n.toLocaleString('pt-BR');
}

export function Chips({ amount, compact, label }: { amount: number; compact?: boolean; label?: string }) {
  return (
    <span className="chips" title={amount.toLocaleString('pt-BR')}>
      <span className="chip-dot" />
      {label && <span className="chips-label">{label}</span>}
      {formatChips(amount, compact)}
    </span>
  );
}

/** Barra de tempo que esvazia até o deadline */
export function TurnTimer({ deadline, totalMs }: { deadline: number | null; totalMs?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const left = Math.max(0, deadline - now);
  const total = totalMs ?? 30_000;
  const pct = Math.min(100, (left / total) * 100);
  return (
    <span className={`turn-timer ${left < 5000 ? 'turn-timer-low' : ''}`}>
      <span className="turn-timer-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

interface SeatBadgeProps {
  name: string;
  isBot?: boolean;
  connected?: boolean;
  /** É a vez deste jogador */
  active?: boolean;
  isMe?: boolean;
  /** Linha extra (ex.: fichas, pontos, aposta) */
  sub?: ReactNode;
  /** Etiqueta pequena (ex.: "D" dealer, "Mão", "Pé", "Dupla A") */
  tag?: string;
  deadline?: number | null;
  turnMs?: number;
  dimmed?: boolean;
}

/** Plaquinha de jogador ao redor da mesa */
export function SeatBadge({ name, isBot, connected = true, active, isMe, sub, tag, deadline, turnMs, dimmed }: SeatBadgeProps) {
  const cls = ['seat', active && 'seat-active', isMe && 'seat-me', !connected && 'seat-off', dimmed && 'seat-dimmed']
    .filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="seat-top">
        <span className="seat-avatar">{isBot ? '🤖' : name.slice(0, 1).toUpperCase()}</span>
        <span className="seat-name" title={name}>{name}</span>
        {tag && <span className="seat-tag">{tag}</span>}
      </div>
      {sub !== undefined && <div className="seat-sub">{sub}</div>}
      {active && deadline ? <TurnTimer deadline={deadline} totalMs={turnMs} /> : null}
      {!connected && <div className="seat-sub seat-warn">desconectado</div>}
    </div>
  );
}

export interface ActionButton {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'danger' | 'default';
  disabled?: boolean;
}

/** Linha de botões de ação (quebra linha em janelas estreitas) */
export function ActionBar({ actions, children }: { actions: ActionButton[]; children?: ReactNode }) {
  return (
    <div className="action-bar">
      {children}
      {actions.map((a) => (
        <button key={a.label} type="button" className={`btn btn-${a.kind ?? 'default'}`} disabled={a.disabled} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Contêiner padrão de mesa: feltro verde que ocupa todo o espaço disponível */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`felt ${className ?? ''}`}>{children}</div>;
}
