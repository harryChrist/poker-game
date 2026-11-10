import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../../store';
import { IconHistory } from '../../ui/icons';
import { Drawer, DrawerEmpty } from './Drawer';

const CARD_RE = /(?<![\p{L}\p{N}])(10|[2-9AJQK])([♠♥♦♣])/gu;

/** Destaca cartas ("7♣", "K♥") no texto: vermelho para ♥/♦, preto para ♠/♣ */
function renderText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(CARD_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const red = m[2] === '♥' || m[2] === '♦';
    out.push(<span key={i++} className={`tl-card ${red ? 'tl-red' : 'tl-blk'}`}>{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const fmtClock = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Gaveta sobreposta com o histórico do que aconteceu na mesa */
export function TableLog({ onClose }: { onClose: () => void }) {
  const history = useStore((s) => s.history);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length]);

  return (
    <Drawer label="Histórico da mesa" title="Histórico da mesa" onClose={onClose}>
      <div className="rdrawer-list selectable tl-list" ref={listRef}>
        {history.length === 0 ? <DrawerEmpty icon={<IconHistory width={22} height={22} />} title="Nada aconteceu ainda" hint="Mãos, apostas e resultados aparecem aqui." /> : history.map((l) => (
          l.type === 'hand_start' ? (
            <div key={l.id} className="tl-sep"><span>{l.text.replace(/[.s]+$/, '')}</span></div>
          ) : (
            <div key={l.id} className="tl-row">
              <span className="tl-time">{fmtClock(l.at)}</span>
              <span className="tl-text">{renderText(l.text)}</span>
            </div>
          )
        ))}
      </div>
    </Drawer>
  );
}

/** Balões discretos de novas mensagens do chat (só com o chat fechado) */
export function ChatPops({ onOpen }: { onOpen: () => void }) {
  const pops = useStore((s) => s.chatPops);
  const dismiss = useStore((s) => s.dismissChatPop);
  return (
    <div className="chat-pops" aria-live="polite">
      {pops.map((p) => <ChatPopItem key={p.id} id={p.id} name={p.name} text={p.text} onOpen={onOpen} onDone={dismiss} />)}
    </div>
  );
}

function ChatPopItem({ id, name, text, onOpen, onDone }: {
  id: number; name: string; text: string; onOpen: () => void; onDone: (id: number) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDone(id), 4000);
    return () => clearTimeout(t);
  }, [id, onDone]);
  return (
    <button type="button" className="chat-pop" onClick={() => { onDone(id); onOpen(); }} title="Abrir o chat">
      <strong>{name}</strong> <span>{text}</span>
    </button>
  );
}
