import { useEffect, type ReactNode } from 'react';
import { IconClose } from '../../ui/icons';

/**
 * Gaveta lateral da sala (chat e histórico). Em janela estreita vira quase tela cheia com um
 * fundo escurecido: tocar fora (ou Esc) fecha. Em tela larga fica ao lado e o jogo segue clicável.
 */
export function Drawer({ label, title, head, onClose, children }: {
  label: string;
  title?: ReactNode;
  head?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rdrawer-wrap">
      <button type="button" className="rdrawer-backdrop" tabIndex={-1} aria-label={`Fechar ${label.toLowerCase()}`} onClick={onClose} />
      <aside className="rdrawer" aria-label={label}>
        <div className="rdrawer-head">
          {title && <strong className="rdrawer-title">{title}</strong>}
          {head}
          <button type="button" className="icon-btn rdrawer-close" onClick={onClose} aria-label={`Fechar ${label.toLowerCase()}`}><IconClose /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** Vazio amigável dentro de uma gaveta */
export function DrawerEmpty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="rdrawer-empty">
      <span className="rdrawer-empty-ico">{icon}</span>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}
