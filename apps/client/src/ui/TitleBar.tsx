import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Chips } from './cards';
import './shell.css';
import { IconClose, IconGear, IconMinimize, IconOpacity, IconPin, IconPinFilled } from './icons';

const CONN_LABEL = {
  online: 'Conectado',
  connecting: 'Conectando…',
  reconnecting: 'Reconectando…',
  offline: 'Sem conexão com o servidor',
} as const;

export function TitleBar() {
  const conn = useStore((s) => s.conn);
  const me = useStore((s) => s.me);
  const desktop = useStore((s) => s.desktop);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const api = window.desktop;
  const dotClass = conn === 'online' ? 'dot-ok' : conn === 'offline' ? 'dot-bad' : 'dot-warn';

  return (
    <header className={`titlebar ${api ? '' : 'titlebar-web'}`}>
      <span className="tb-logo" aria-hidden>♠</span>
      <span className="tb-title">Mesa de Cartas</span>
      <span className="tb-conn no-drag" title={CONN_LABEL[conn]} role="status" aria-label={CONN_LABEL[conn]}>
        <span className={`conn-dot ${dotClass}`} />
        <span className="tb-conn-text">{CONN_LABEL[conn]}</span>
      </span>
      <span className="tb-spacer" />
      {me && (
        // total = carteira + fichas na mesa/apostadas: sobe e desce ao vivo enquanto você joga
        <span className="tb-balance no-drag"
          title={`Total: ${(me.balance + me.inPlay).toLocaleString('pt-BR')} (carteira ${me.balance.toLocaleString('pt-BR')} + na mesa ${me.inPlay.toLocaleString('pt-BR')})`}>
          <Chips amount={me.balance + me.inPlay} compact />
        </span>
      )}
      {api && (
        <button type="button" className={`tb-btn ${desktop?.alwaysOnTop ? 'tb-on' : ''}`}
          title={desktop?.alwaysOnTop ? 'Sempre no topo: ligado' : 'Sempre no topo: desligado'}
          aria-pressed={!!desktop?.alwaysOnTop}
          onClick={() => void api.setAlwaysOnTop(!desktop?.alwaysOnTop)}>
          {desktop?.alwaysOnTop ? <IconPinFilled /> : <IconPin />}
        </button>
      )}
      {api && <OpacityButton />}
      <button type="button" className="tb-btn" title="Configurações" aria-label="Configurações" onClick={() => openSettings(true)}><IconGear /></button>
      {api && (
        <>
          <button type="button" className="tb-btn" title="Minimizar" aria-label="Minimizar" onClick={() => api.minimize()}><IconMinimize /></button>
          <button type="button" className="tb-btn tb-close" title="Esconder na bandeja" aria-label="Esconder na bandeja" onClick={() => api.hide()}><IconClose /></button>
        </>
      )}
    </header>
  );
}

function OpacityButton() {
  const opacity = useStore((s) => s.desktop?.opacity ?? 1);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(opacity);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => setLocal(opacity), [opacity]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span className="tb-pop-wrap no-drag" ref={ref}>
      <button type="button" className={`tb-btn ${open ? 'tb-on' : ''}`} title="Opacidade da janela" aria-label="Opacidade da janela" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconOpacity />
      </button>
      {open && (
        <div className="popover">
          <label className="between label" htmlFor="opacity-slider"><span>Opacidade</span><b>{Math.round(local * 100)}%</b></label>
          <input id="opacity-slider" type="range" min={30} max={100} step={1} value={Math.round(local * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setLocal(v);
              void window.desktop?.setOpacity(v);
            }} />
        </div>
      )}
    </span>
  );
}
