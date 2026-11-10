import { useState, type FormEvent } from 'react';
import { authenticate, dropSession } from '../net/actions';
import { getLastUsername, getServerUrl } from '../net/socket';
import { useStore } from '../store';
import { Tabs } from '../ui/widgets';

type Mode = 'login' | 'register';

export function Login() {
  const notice = useStore((s) => s.loginNotice);
  const conn = useStore((s) => s.conn);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(getLastUsername());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [server, setServer] = useState(getServerUrl());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!name || !password) {
      setError('Informe usuário e senha.');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await authenticate(mode, name, password, server);
    setBusy(false);
    if (err) setError(err);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  return (
    <div className="screen login">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-spade" aria-hidden>♠</span>
          <h1>Mesa de Cartas</h1>
          <p className="muted-text">Jogos de cartas com fichas virtuais, entre amigos.</p>
        </div>

        <Tabs<Mode> tabs={[{ id: 'login', label: 'Entrar' }, { id: 'register', label: 'Criar conta' }]}
          value={mode} onChange={switchMode} />

        {notice && <div className="banner banner-warn">{notice}</div>}

        <form onSubmit={submit} className="stack" autoComplete="on">
          <label className="field">
            <span className="label">Usuário</span>
            <input className="input" autoFocus value={username} maxLength={32} autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Senha</span>
            <input className="input" type="password" value={password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)} />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span className="label">Confirmar senha</span>
              <input className="input" type="password" value={confirm} autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}

          <details className="advanced">
            <summary>Avançado</summary>
            <label className="field">
              <span className="label">Servidor</span>
              <input className="input" value={server} spellCheck={false} placeholder="https://cardgame.hchrist.com"
                onChange={(e) => setServer(e.target.value)} />
            </label>
          </details>

          {error && <div className="banner banner-error" role="alert">{error}</div>}
          {conn === 'offline' && !error && (
            <div className="banner banner-warn">Sem conexão com o servidor. Verifique o endereço em “Avançado”.</div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta e entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Tela mostrada enquanto restaura a sessão salva */
export function Splash() {
  const conn = useStore((s) => s.conn);
  const openSettings = useStore((s) => s.setSettingsOpen);
  return (
    <div className="screen splash">
      <span className="login-spade" aria-hidden>♠</span>
      {conn === 'offline' ? (
        <>
          <p>Sem conexão com <strong className="selectable">{getServerUrl()}</strong></p>
          <p className="muted-text">Continuando a tentar…</p>
          <div className="row-center">
            <button type="button" className="btn" onClick={() => openSettings(true)}>Configurar servidor</button>
            <button type="button" className="btn btn-ghost" onClick={() => dropSession(null)}>Usar outra conta</button>
          </div>
        </>
      ) : (
        <>
          <span className="spinner" />
          <p className="muted-text">Conectando ao servidor…</p>
        </>
      )}
    </div>
  );
}
