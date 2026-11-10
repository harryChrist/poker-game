import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomState } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { fmtTime } from '../../ui/format';
import { IconChat, IconHistory, IconSend } from '../../ui/icons';
import { Drawer, DrawerEmpty } from './Drawer';

type View = 'chat' | 'log';
const VIEWS: { id: View; label: string }[] = [{ id: 'chat', label: 'Chat' }, { id: 'log', label: 'Eventos' }];

/** Gaveta sobreposta com o chat da sala e o log de eventos do jogo */
export function ChatDrawer({ room, onClose }: { room: RoomState; onClose: () => void }) {
  const meId = useStore((s) => s.me?.id);
  const chat = useStore((s) => s.chat);
  const log = useStore((s) => s.log);
  const [view, setView] = useState<View>('chat');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const messages = chat.filter((m) => m.roomId === room.id);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, log.length, view]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const res = await act('chat:send', { text: t });
    if (!res.ok) setText(t);
  };

  const head = (
    <div className="rseg" role="tablist" aria-label="Chat ou eventos">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <Drawer label="Chat da sala" head={head} onClose={onClose}>
      <div className="rdrawer-list selectable" ref={listRef}>
        {view === 'chat' ? (
          messages.length === 0 ? <DrawerEmpty icon={<IconChat width={22} height={22} />} title="Nenhuma mensagem ainda" hint="Diga olá para a mesa." /> : messages.map((m, i) => {
            if (m.system) return <div key={m.id} className="cmsg cmsg-system"><span>{m.text}</span></div>;
            const prev = messages[i - 1];
            const grouped = !!prev && !prev.system && prev.userId === m.userId && m.at - prev.at < 60_000;
            const mine = m.userId === meId;
            return (
              <div key={m.id} className={`cmsg ${mine ? 'cmsg-me' : ''} ${grouped ? 'cmsg-grouped' : ''}`}>
                {!grouped && <span className="cmsg-meta"><strong>{mine ? 'Você' : m.name}</strong><span>{fmtTime(m.at)}</span></span>}
                <span className="cmsg-bubble">{m.text}</span>
              </div>
            );
          })
        ) : (
          log.length === 0 ? <DrawerEmpty icon={<IconHistory width={22} height={22} />} title="Sem eventos ainda" hint="As jogadas recentes aparecem aqui." /> : log.map((l) => (
            <div key={l.id} className="cmsg cmsg-event"><time>{fmtTime(l.at)}</time><span>{l.text}</span></div>
          ))
        )}
      </div>
      {view === 'chat' && (
        <form className="rdrawer-input" onSubmit={send}>
          <input className="input" value={text} maxLength={200} placeholder="Escreva uma mensagem…" autoFocus aria-label="Mensagem"
            onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-icon-only" disabled={!text.trim()} aria-label="Enviar" title="Enviar"><IconSend /></button>
        </form>
      )}
    </Drawer>
  );
}
