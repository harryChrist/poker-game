import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Largura máxima do cartão em px (a janela pequena sempre limita) */
  width?: number;
}

/** Janela modal que cabe em 340x460: rola internamente e deixa a barra de título livre */
export function Modal({ title, onClose, children, footer, width = 420 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // foco: entra no diálogo (se nada dentro já pegou autoFocus) e volta ao elemento anterior ao fechar
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, .modal-foot .btn-primary') ?? el).focus({ preventScroll: true });
    }
    return () => { if (prev && document.contains(prev)) prev.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><IconClose /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
