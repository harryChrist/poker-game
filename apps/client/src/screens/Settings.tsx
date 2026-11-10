import { useState, type KeyboardEvent } from 'react';
import { applyServerUrl, logout } from '../net/actions';
import { getServerUrl } from '../net/socket';
import { useStore } from '../store';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/widgets';

const MODIFIER_CODES = ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'];

/** Converte um KeyboardEvent em acelerador do Electron (ou null se ainda incompleto/inválido) */
function toAccelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_CODES.includes(e.code)) return null;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else {
    const map: Record<string, string> = {
      Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
    };
    key = map[e.code] ?? null;
  }
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (mods.length === 0) return null;
  return [...mods, key].join('+');
}

const prettyAccel = (a: string) => a.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win').replace(/\+/g, ' + ');

export function SettingsModal() {
  const close = () => useStore.getState().setSettingsOpen(false);
  const me = useStore((s) => s.me);
  const desktop = useStore((s) => s.desktop);
  const toast = useStore((s) => s.toast);
  const api = window.desktop;

  const [url, setUrl] = useState(getServerUrl());
  const [recording, setRecording] = useState(false);
  const [hotkeyMsg, setHotkeyMsg] = useState<string | null>(null);

  const saveUrl = () => {
    const normalized = applyServerUrl(url);
    setUrl(normalized);
    toast('info', `Servidor: ${normalized}`);
  };

  const onKey = async (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || !api) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setRecording(false);
    const accel = toAccelerator(e);
    if (!accel) return;
    setRecording(false);
    const res = await api.setHotkey(accel);
    setHotkeyMsg(res.ok ? 'Atalho atualizado.' : res.error ?? 'Não foi possível usar este atalho.');
  };

  return (
    <Modal title="Configurações" onClose={close} width={420}>
      <div className="stack">
        <section className="stack">
          <h3>Servidor</h3>
          <div className="toolbar">
            <input className="input" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveUrl(); }} />
            <button type="button" className="btn" onClick={saveUrl} disabled={url.trim() === getServerUrl()}>Salvar</button>
          </div>
          <span className="hint">Ao trocar o servidor o app reconecta; talvez seja preciso entrar de novo.</span>
        </section>

        {api && desktop && (
          <section className="stack">
            <h3>Janela</h3>
            <Switch checked={desktop.alwaysOnTop} onChange={(v) => void api.setAlwaysOnTop(v)} label="Sempre no topo" />
            <label className="field">
              <span className="label">Opacidade: {Math.round(desktop.opacity * 100)}%</span>
              <input type="range" min={30} max={100} value={Math.round(desktop.opacity * 100)}
                onChange={(e) => void api.setOpacity(Number(e.target.value) / 100)} />
            </label>
            <div className="field">
              <span className="label">Atalho global para esconder/mostrar</span>
              <button type="button" className={`input hotkey ${recording ? 'hotkey-rec' : ''}`}
                onClick={() => { setRecording(true); setHotkeyMsg(null); }}
                onKeyDown={onKey} onBlur={() => setRecording(false)}>
                {recording ? 'Pressione o novo atalho… (Esc cancela)' : prettyAccel(desktop.hotkey)}
              </button>
              {desktop.hotkeyError && !hotkeyMsg && <span className="hint neg">{desktop.hotkeyError}</span>}
              {hotkeyMsg && <span className="hint">{hotkeyMsg}</span>}
            </div>
          </section>
        )}

        {me && (
          <section className="stack">
            <h3>Conta</h3>
            <div className="between">
              <span className="muted-text">Conectado como <strong>{me.username}</strong></span>
              <button type="button" className="btn btn-danger" onClick={() => void logout()}>Sair da conta</button>
            </div>
          </section>
        )}

        {api && (
          <button type="button" className="btn btn-ghost" onClick={() => api.quit()}>Encerrar o aplicativo</button>
        )}
      </div>
    </Modal>
  );
}
