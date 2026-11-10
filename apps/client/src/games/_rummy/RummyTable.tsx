import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RANK_LABEL, cardLabel, type Card as CardT } from '@cards/shared';
import type { RummyAction, RummyView, Reveal } from '@cards/games/_rummy';
import { Card, CardBack, SeatBadge, Table } from '../../ui/cards';
import type { GameViewProps } from '../types';
import './rummy.css';

export interface RummyTableProps extends GameViewProps<RummyView, RummyAction> {
  /** Prefixo de classe do jogo ('cacheta' | 'pife'), aplicado na raiz como `${prefix}-root` */
  prefix: 'cacheta' | 'pife';
}

/** Ordena `hand` seguindo `order` (ids desconhecidos vão para o fim, mantendo a ordem relativa) */
function applyOrder(hand: CardT[], order: string[] | null): CardT[] {
  if (!order) return hand;
  const pos = new Map(order.map((id, i) => [id, i]));
  return hand
    .map((c, i) => ({ c, k: pos.has(c.id) ? pos.get(c.id)! : order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c);
}

function moveTo(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const out = ids.slice();
  out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
}

const GROUP_CLASSES = 4;

export default function RummyTable({ view, mySeat, room, turn, sendAction, prefix }: RummyTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // nova rodada: zera seleção e ordem local
  useEffect(() => { setSelectedId(null); setLocalOrder(null); }, [view.round]);

  const act = useCallback(async (action: RummyAction) => {
    try {
      const r = await sendAction(action);
      if (!r.ok) showToast(r.error ?? 'Não foi possível fazer isso.');
      return r.ok;
    } catch {
      showToast('Falha de conexão.');
      return false;
    }
  }, [sendAction, showToast]);

  const hand = useMemo(() => applyOrder(view.hand, localOrder), [view.hand, localOrder]);
  const handIds = useMemo(() => hand.map((c) => c.id), [hand]);

  // se a carta selecionada saiu da mão, limpa
  useEffect(() => {
    if (selectedId && !handIds.includes(selectedId)) setSelectedId(null);
  }, [handIds, selectedId]);

  const groupOf = useMemo(() => {
    const m = new Map<string, number>();
    view.arrangement?.groups.forEach((g, gi) => g.forEach((id) => m.set(id, gi)));
    return m;
  }, [view.arrangement]);

  const playing = view.phase === 'play';
  const isPlayer = mySeat !== null;
  const myTurn = playing && isPlayer && view.turnSeat === mySeat;
  const { legal } = view;
  const canReorder = playing && isPlayer && hand.length > 1;
  const turnMs = (room.config.turnSeconds ?? 25) * 1000;
  const wild = view.wildRank;

  const reorder = (ids: string[]) => {
    setLocalOrder(ids);
    void act({ type: 'reorder', cardIds: ids });
  };

  const organize = () => {
    if (!view.arrangement) return;
    const byId = new Set(handIds);
    const ids = [...view.arrangement.groups.flat(), ...view.arrangement.loose].filter((id) => byId.has(id));
    reorder(ids);
  };

  const moveSelected = (dir: -1 | 1) => {
    if (!selectedId) return;
    const i = handIds.indexOf(selectedId);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= handIds.length) return;
    reorder(moveTo(handIds, selectedId, to));
  };

  const doDiscard = async () => {
    if (!selectedId) return;
    if (await act({ type: 'discard', cardId: selectedId })) setSelectedId(null);
  };

  // carta que será descartada ao bater
  const knockCardId = legal.knockDiscards.includes(selectedId ?? '') ? selectedId : (legal.knockDiscards[0] ?? null);
  const knockCard = knockCardId ? hand.find((c) => c.id === knockCardId) : undefined;
  const doKnock = async () => {
    if (await act({ type: 'knock', discardId: knockCardId })) setSelectedId(null);
  };

  // oponentes em ordem horária a partir de mim
  const n = view.players.length;
  const start = mySeat ?? -1;
  const opponents = Array.from({ length: n }, (_, i) => (start + 1 + i) % n)
    .filter((s) => s !== mySeat)
    .map((s) => view.players[s]);
  const POS: Record<number, string[]> = {
    1: ['t'], 2: ['tl', 'tr'], 3: ['l', 't', 'r'], 4: ['l', 'tl', 'tr', 'r'], 5: ['l', 'tl', 't', 'tr', 'r'],
    6: ['l', 'tl', 't', 'tr', 'r', 'b'],
  };
  const positions = POS[Math.min(opponents.length, 6)] ?? [];

  const scoreText = (score: number, alive: boolean) => {
    if (view.scoreKind === 'lives') return alive ? `${'♥'.repeat(Math.min(score, 10))}` : 'fora';
    return `${score}/${view.target} vit.`;
  };

  const nameOf = (seat: number) => view.players[seat]?.name ?? '?';
  const connected = (seat: number) => room.seats[seat]?.connected ?? true;

  let hint: string;
  if (view.phase === 'over') hint = view.result?.summary ?? 'Fim de jogo.';
  else if (view.phase === 'roundEnd') hint = 'Fim da rodada.';
  else if (myTurn && view.turnStep === 'draw') hint = 'Sua vez: compre do monte ou pegue o descarte.';
  else if (myTurn) hint = legal.knock ? `Dá para BATER${knockCard ? ` (descarta ${cardLabel(knockCard)})` : ''}! Ou descarte outra.` : 'Selecione uma carta e descarte.';
  else if (view.turnSeat !== null) hint = `Vez de ${nameOf(view.turnSeat)}${view.turnStep === 'discard' ? ' (descartando)' : ''}...`;
  else hint = '';

  const arrangement = view.arrangement;
  const nGroups = arrangement?.groups.length ?? 0;
  const nLoose = arrangement?.loose.length ?? 0;

  const handStyle = { '--n': Math.max(hand.length, 1) } as CSSProperties;

  return (
    <Table className={`rummy-root ${prefix}-root`}>
      {toast && <div className="rummy-toast" role="alert">{toast}</div>}

      <div className="rummy-board" data-n={opponents.length}>
        <div className="rummy-opps">
          {opponents.map((p, i) => (
            <div key={p.seat} className="rummy-opp" data-pos={positions[i]}>
              <SeatBadge
                name={p.name} isBot={p.isBot} connected={connected(p.seat)}
                active={playing && view.turnSeat === p.seat} deadline={turn.deadline} turnMs={turnMs}
                tag={view.dealer === p.seat ? 'D' : undefined} dimmed={!p.alive}
                sub={<span className={`rummy-score ${view.scoreKind === 'lives' ? 'rummy-lives' : ''}`}>{scoreText(p.score, p.alive)}</span>}
              />
              {p.handCount > 0 && (
                <div className="rummy-opp-cards" aria-label={`${p.handCount} cartas`}>
                  {Array.from({ length: Math.min(p.handCount, 5) }, (_, k) => <CardBack key={k} size="xs" />)}
                  <span className="rummy-opp-count">{p.handCount}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rummy-center">
          <div className="rummy-piles">
            <button type="button" className={`rummy-pile ${legal.drawDeck ? 'rummy-pile-active' : ''}`}
              disabled={!legal.drawDeck} onClick={() => void act({ type: 'draw', from: 'deck' })}
              title="Comprar do monte">
              <CardBack size="md" />
              <span className="rummy-pile-label">Monte {view.deckCount}</span>
            </button>
            <div className={`rummy-pile ${legal.drawDiscard ? 'rummy-pile-active' : ''}`}>
              {view.discardTop ? (
                <Card card={view.discardTop} size="md" highlight={legal.drawDiscard}
                  onClick={legal.drawDiscard ? () => void act({ type: 'draw', from: 'discard' }) : undefined}
                  title="Pegar o descarte" />
              ) : (
                <span className="pc pc-md pc-slot">vazio</span>
              )}
              <span className="rummy-pile-label">Descarte</span>
            </div>
            {view.vira && wild && (
              <div className="rummy-pile rummy-vira">
                <Card card={view.vira} size="sm" title="Vira" />
                <span className="rummy-pile-label">Vira</span>
              </div>
            )}
            {wild && (
              <div className="rummy-wild" title="Cartas desse valor, de qualquer naipe, valem qualquer carta">
                <span className="rummy-wild-star">★</span>
                <span className="rummy-wild-rank">{RANK_LABEL[wild]}</span>
                <span className="rummy-pile-label">Coringa</span>
              </div>
            )}
          </div>
          <div className="rummy-hint" aria-live="polite">{hint}</div>
        </div>
      </div>

      {isPlayer && view.hand.length > 0 && (
        <div className="rummy-me">
          <div className="rummy-me-top">
            <SeatBadge
              name={view.players[mySeat!].name} isMe active={myTurn} deadline={turn.deadline} turnMs={turnMs}
              tag={view.dealer === mySeat ? 'D' : undefined}
              sub={<span className={`rummy-score ${view.scoreKind === 'lives' ? 'rummy-lives' : ''}`}>{scoreText(view.players[mySeat!].score, view.players[mySeat!].alive)}</span>}
            />
            <span className="rummy-status">
              {nGroups} {nGroups === 1 ? 'jogo' : 'jogos'} · {nLoose} {nLoose === 1 ? 'solta' : 'soltas'}
            </span>
          </div>

          <div className="rummy-hand hand-mine" style={handStyle}>
            {hand.map((c, i) => {
              const g = groupOf.get(c.id);
              return (
                <div key={c.id} className="rummy-slot"
                  data-g={g !== undefined ? g % GROUP_CLASSES : undefined}
                  data-new={c.id === view.drawnId ? '1' : undefined}
                  data-sel={c.id === selectedId ? '1' : undefined}
                  data-over={overIdx === i && dragId !== c.id ? '1' : undefined}
                  draggable={canReorder}
                  onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverIdx(i); } }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && dragId !== c.id) reorder(moveTo(handIds, dragId, i));
                    setDragId(null); setOverIdx(null);
                  }}
                  onDragEnd={() => { setDragId(null); setOverIdx(null); }}
                >
                  <Card card={c} size="md" selected={c.id === selectedId}
                    highlight={!!wild && c.r === wild}
                    title={`${cardLabel(c)}${wild && c.r === wild ? ' (coringa)' : ''}`}
                    style={{ '--w': 'var(--rw)' } as CSSProperties}
                    onClick={() => setSelectedId((cur) => (cur === c.id ? null : c.id))} />
                </div>
              );
            })}
          </div>

          <div className="rummy-tools">
            <button type="button" className="btn rummy-mini rummy-arrow" disabled={!selectedId || !canReorder} onClick={() => moveSelected(-1)} title="Mover para a esquerda" aria-label="Mover para a esquerda">◀</button>
            <button type="button" className="btn rummy-mini rummy-arrow" disabled={!selectedId || !canReorder} onClick={() => moveSelected(1)} title="Mover para a direita" aria-label="Mover para a direita">▶</button>
            <button type="button" className="btn rummy-mini" disabled={!canReorder} onClick={organize} title="Agrupar a melhor divisão em jogos">Organizar</button>
            <span className="rummy-tools-gap" />
            <button type="button" className="btn rummy-mini" disabled={!(myTurn && view.turnStep === 'discard' && selectedId && legal.discards.includes(selectedId))}
              onClick={() => void doDiscard()}>Descartar</button>
            <button type="button" className="btn btn-primary rummy-mini rummy-knock" disabled={!(myTurn && legal.knock)} onClick={() => void doKnock()}>BATER</button>
          </div>
        </div>
      )}

      {(view.phase === 'roundEnd' || view.phase === 'over') && view.reveal && (
        <RevealPanel view={view} reveal={view.reveal} nameOf={nameOf} mySeat={mySeat} />
      )}
    </Table>
  );
}

function RevealPanel({ view, reveal, nameOf, mySeat }: {
  view: RummyView; reveal: Reveal; nameOf: (s: number) => string; mySeat: number | null;
}) {
  const hands = reveal.hands.slice().sort((a, b) => Number(b.knocker) - Number(a.knocker));
  const over = view.phase === 'over';
  const winnerSeats = view.result?.winners ?? [];
  return (
    <div className="rummy-reveal" role="dialog" aria-label="Fim da rodada">
      <div className="rummy-reveal-card">
        <div className="rummy-reveal-title">{over && view.result ? `🏆 ${view.result.summary}` : reveal.text}</div>
        {over && <div className="rummy-reveal-sub">{reveal.text}</div>}
        {hands.map((h) => {
          const delta = h.eliminated
            ? 'eliminado'
            : h.delta < 0 ? '-1 vida' : h.delta > 0 ? '+1 vitória' : '';
          return (
            <div key={h.seat} className={`rummy-rh ${h.knocker ? 'rummy-rh-win' : ''} ${h.seat === mySeat ? 'rummy-rh-me' : ''}`}>
              <div className="rummy-rh-head">
                <span className="rummy-rh-name">{h.knocker ? '✔ ' : ''}{nameOf(h.seat)}{winnerSeats.includes(h.seat) ? ' 🏆' : ''}</span>
                {delta && <span className={`rummy-rh-delta ${h.delta < 0 ? 'rummy-neg' : 'rummy-pos'}`}>{delta}</span>}
              </div>
              <div className="rummy-rh-cards">
                {h.groups.map((g, gi) => (
                  <div key={gi} className="rummy-rh-group" data-g={gi % GROUP_CLASSES}>
                    {g.map((c) => <Card key={c.id} card={c} size="xs" highlight={!!view.wildRank && c.r === view.wildRank} />)}
                  </div>
                ))}
                {h.loose.length > 0 && (
                  <div className="rummy-rh-group rummy-rh-loose">
                    {h.loose.map((c) => <Card key={c.id} card={c} size="xs" dimmed />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {reveal.discarded && <div className="rummy-reveal-sub">Descartou {cardLabel(reveal.discarded)} ao bater.</div>}
        {!over && <div className="rummy-reveal-sub">Próxima rodada em instantes...</div>}
      </div>
    </div>
  );
}
