import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomState } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { fmtTime } from '../../ui/format';
import { IconClose, IconSend } from '../../ui/icons';
import { Tabs } from '../../ui/widgets';

type View = 'chat' | 'log';

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

  return (
    <aside className="drawer" aria-label="Chat da sala">
      <div className="drawer-head">
        <Tabs<View> tabs={[{ id: 'chat', label: 'Chat' }, { id: 'log', label: 'Eventos' }]} value={view} onChange={setView} />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar chat"><IconClose /></button>
      </div>
      <div className="drawer-list selectable" ref={listRef}>
        {view === 'chat' ? (
          messages.length === 0 ? <p className="muted-text center">Nenhuma mensagem ainda.</p> : messages.map((m) => (
            <div key={m.id} className={`msg ${m.system ? 'msg-system' : ''} ${m.userId === meId ? 'msg-me' : ''}`}>
              {m.system ? <span>{m.text}</span> : (
                <>
                  <span className="msg-meta"><strong>{m.name}</strong> <span>{fmtTime(m.at)}</span></span>
                  <span className="msg-text">{m.text}</span>
                </>
              )}
            </div>
          ))
        ) : (
          log.length === 0 ? <p className="muted-text center">Sem eventos ainda.</p> : log.map((l) => (
            <div key={l.id} className="msg msg-system"><span>{fmtTime(l.at)} · {l.text}</span></div>
          ))
        )}
      </div>
      {view === 'chat' && (
        <form className="drawer-input" onSubmit={send}>
          <input className="input" value={text} maxLength={200} placeholder="Mensagem…" autoFocus
            onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-icon-only" disabled={!text.trim()} aria-label="Enviar"><IconSend /></button>
        </form>
      )}
    </aside>
  );
}
