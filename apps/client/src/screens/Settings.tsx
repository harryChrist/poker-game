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

  const saved = url.trim() === getServerUrl();
  const accelParts = desktop ? prettyAccel(desktop.hotkey).split(' + ') : [];

  return (
    <Modal title="Configurações" onClose={close} width={440}>
      <div className="st">
        {me && (
          <section className="st-sec">
            <h3>Conta</h3>
            <div className="st-account">
              <span className="st-avatar" aria-hidden>{me.username.slice(0, 1).toUpperCase()}</span>
              <span className="st-who">
                <strong title={me.username}>{me.username}</strong>
                <span className="muted-text small">{me.role === 'admin' ? 'Administrador' : 'Jogador'}</span>
              </span>
              <button type="button" className="btn btn-sm btn-danger-outline" onClick={() => void logout()}>Sair da conta</button>
            </div>
          </section>
        )}

        <section className="st-sec">
          <h3>Servidor</h3>
          <div className="toolbar">
            <input className="input" value={url} spellCheck={false} aria-label="Endereço do servidor" onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveUrl(); }} />
            <button type="button" className="btn btn-primary" onClick={saveUrl} disabled={saved}>Salvar</button>
          </div>
          <span className="hint">Ao trocar o servidor o app reconecta; talvez seja preciso entrar de novo.</span>
        </section>

        {api && desktop ? (
          <section className="st-sec">
            <h3>Janela</h3>
            <Switch checked={desktop.alwaysOnTop} onChange={(v) => void api.setAlwaysOnTop(v)} label="Manter sempre no topo" />
            <label className="field st-range">
              <span className="between"><span className="label">Opacidade</span><span className="st-val">{Math.round(desktop.opacity * 100)}%</span></span>
              <input type="range" min={30} max={100} value={Math.round(desktop.opacity * 100)}
                onChange={(e) => void api.setOpacity(Number(e.target.value) / 100)} />
            </label>
            <div className="field">
              <span className="label">Atalho global para esconder/mostrar</span>
              <button type="button" className={`input hotkey ${recording ? 'hotkey-rec' : ''}`}
                onClick={() => { setRecording(true); setHotkeyMsg(null); }}
                onKeyDown={onKey} onBlur={() => setRecording(false)}>
                {recording ? <span className="st-rec">Pressione o novo atalho… (Esc cancela)</span> : (
                  <>
                    <span className="st-keys">
                      {accelParts.map((k, i) => <kbd key={i}>{k}</kbd>)}
                    </span>
                    <span className="st-change">Alterar</span>
                  </>
                )}
              </button>
              {desktop.hotkeyError && !hotkeyMsg && <span className="hint neg">{desktop.hotkeyError}</span>}
              {hotkeyMsg && <span className="hint">{hotkeyMsg}</span>}
            </div>
          </section>
        ) : (
          <p className="hint st-note">As opções de janela (sempre no topo, opacidade e atalho) aparecem no aplicativo de desktop.</p>
        )}

        {api && (
          <section className="st-sec">
            <h3>Aplicativo</h3>
            <div className="between">
              <span className="muted-text">Fecha de vez, inclusive da bandeja.</span>
              <button type="button" className="btn btn-sm" onClick={() => api.quit()}>Encerrar aplicativo</button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
