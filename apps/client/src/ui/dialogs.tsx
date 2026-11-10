import { useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { Modal } from './Modal';

interface ConfirmReq {
  kind: 'confirm';
  id: number;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
interface PromptReq {
  kind: 'prompt';
  id: number;
  title: string;
  message?: string;
  label: string;
  inputType?: 'text' | 'password' | 'number';
  confirmLabel?: string;
  initial?: string;
  resolve: (value: string | null) => void;
}
type Req = ConfirmReq | PromptReq;

let nextId = 1;
const useDialogs = create<{ current: Req | null; set(r: Req | null): void }>()((set) => ({
  current: null,
  set: (current) => set({ current }),
}));

/** Pergunta Sim/Não. Resolve true se confirmado. */
export function askConfirm(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.getState().set({ kind: 'confirm', id: nextId++, ...opts, resolve });
  });
}

/** Pede um texto. Resolve null se cancelado. */
export function askText(opts: {
  title: string; label: string; message?: string; inputType?: 'text' | 'password' | 'number'; confirmLabel?: string; initial?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.getState().set({ kind: 'prompt', id: nextId++, ...opts, resolve });
  });
}

export function DialogHost() {
  const req = useDialogs((s) => s.current);
  if (!req) return null;
  const close = () => useDialogs.getState().set(null);
  if (req.kind === 'confirm') {
    const done = (ok: boolean) => { close(); req.resolve(ok); };
    return (
      <Modal title={req.title} onClose={() => done(false)} width={340}
        footer={<>
          <button type="button" className="btn" onClick={() => done(false)}>Cancelar</button>
          <button type="button" autoFocus className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>
            {req.confirmLabel ?? 'Confirmar'}
          </button>
        </>}>
        {req.message && <p className="dlg-msg">{req.message}</p>}
      </Modal>
    );
  }
  return <PromptDialog key={req.id} req={req} onDone={(v) => { close(); req.resolve(v); }} />;
}

function PromptDialog({ req, onDone }: { req: PromptReq; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(req.initial ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onDone(value);
  };
  return (
    <Modal title={req.title} onClose={() => onDone(null)} width={340}>
      <form onSubmit={submit} className="stack">
        {req.message && <p className="dlg-msg">{req.message}</p>}
        <label className="field">
          <span className="label">{req.label}</span>
          <input className="input" autoFocus type={req.inputType ?? 'text'} value={value} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="row-end">
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>{req.confirmLabel ?? 'OK'}</button>
        </div>
      </form>
    </Modal>
  );
}
