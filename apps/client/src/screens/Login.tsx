import { useState, type CSSProperties, type FormEvent } from 'react';
import { GAMES, type GameId } from '@cards/shared';
import { authenticate, dropSession } from '../net/actions';
import { getLastUsername, getServerUrl } from '../net/socket';
import { useStore } from '../store';
import { GAME_ART } from '../ui/gameArt';
import { IconEye, IconEyeOff } from '../ui/icons';
import { Tabs } from '../ui/widgets';

type Mode = 'login' | 'register';

const GAME_IDS = Object.keys(GAME_ART) as GameId[];
/** "Poker Texas Hold'em" -> "Poker", "Blackjack (21)" -> "Blackjack" */
const shortName = (id: GameId) => (GAMES[id]?.name ?? id).replace(/\s*\(.*\)/, '').split(' ')[0];

/** Leque decorativo de cartas e fichas em CSS puro */
function Decor() {
  return (
    <div className="lg-decor" aria-hidden>
      <span className="lg-pc lg-pc-1"><b>A</b><i>♠</i></span>
      <span className="lg-pc lg-pc-2 lg-red"><b>K</b><i>♥</i></span>
      <span className="lg-pc lg-pc-3"><b>Q</b><i>♣</i></span>
      <span className="lg-pc lg-pc-4 lg-red"><b>J</b><i>♦</i></span>
      <span className="lg-chip lg-chip-1" />
      <span className="lg-chip lg-chip-2" />
      <span className="lg-chip lg-chip-3" />
    </div>
  );
}

function Hero() {
  return (
    <div className="lg-hero">
      <Decor />
      <div className="lg-brand">
        <span className="lg-mark" aria-hidden>♠</span>
        <div className="lg-brand-text">
          <h1>Mesa de Cartas</h1>
          <p>Jogos de cartas com fichas virtuais, entre amigos.</p>
        </div>
      </div>
      <ul className="lg-games" aria-label="Jogos disponíveis">
        {GAME_IDS.map((id) => (
          <li key={id} className="lg-game" style={{ '--gc': GAME_ART[id].color } as CSSProperties}
            title={`${GAMES[id]?.name ?? id}: ${GAME_ART[id].tagline}`}>
            <span className="lg-game-icon">{GAME_ART[id].icon}</span>
            <span className="lg-game-text">
              <strong>{shortName(id)}</strong>
              <small>{GAME_ART[id].tagline}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="lg-fine">Fichas virtuais, sem dinheiro de verdade.</p>
    </div>
  );
}

export function Login() {
  const notice = useStore((s) => s.loginNotice);
  const conn = useStore((s) => s.conn);
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(getLastUsername());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
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

  const isRegister = mode === 'register';
  const serverChanged = server.trim() !== getServerUrl();

  return (
    <div className="screen login">
      <div className="lg-wrap">
        <Hero />

        <section className="lg-panel">
          <div className="lg-panel-head">
            <h2>{isRegister ? 'Criar sua conta' : 'Bem-vindo de volta'}</h2>
            <p className="muted-text">{isRegister ? 'Você começa com fichas de graça para jogar.' : 'Entre para voltar à mesa.'}</p>
          </div>

          <Tabs<Mode> tabs={[{ id: 'login', label: 'Entrar' }, { id: 'register', label: 'Criar conta' }]}
            value={mode} onChange={switchMode} />

          {notice && <div className="banner banner-warn">{notice}</div>}

          <form onSubmit={submit} className="stack lg-form" autoComplete="on" noValidate>
            <label className="field">
              <span className="label">Usuário</span>
              <input className="input lg-input" autoFocus value={username} maxLength={32} autoComplete="username"
                autoCapitalize="none" spellCheck={false} placeholder="seu nome de jogador"
                onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Senha</span>
              <span className="lg-pw">
                <input className="input lg-input" type={showPw ? 'text' : 'password'} value={password}
                  autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="lg-eye" onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? 'Esconder senha' : 'Mostrar senha'} aria-pressed={showPw}>
                  {showPw ? <IconEyeOff /> : <IconEye />}
                </button>
              </span>
            </label>
            {isRegister && (
              <label className="field">
                <span className="label">Confirmar senha</span>
                <input className="input lg-input" type={showPw ? 'text' : 'password'} value={confirm} autoComplete="new-password"
                  placeholder="repita a senha" onChange={(e) => setConfirm(e.target.value)} />
              </label>
            )}

            <details className="advanced lg-adv">
              <summary>Avançado {serverChanged && <span className="badge badge-accent">servidor alterado</span>}</summary>
              <label className="field">
                <span className="label">Servidor</span>
                <input className="input lg-input" value={server} spellCheck={false} placeholder="https://cardgame.hchrist.com"
                  onChange={(e) => setServer(e.target.value)} />
                <span className="hint">Endereço do servidor de jogo. Só mude se alguém do grupo hospeda o próprio.</span>
              </label>
            </details>

            {error && <div className="banner banner-error" role="alert">{error}</div>}
            {conn === 'offline' && !error && (
              <div className="banner banner-warn">Sem conexão com o servidor. Verifique o endereço em “Avançado”.</div>
            )}

            <button type="submit" className="btn btn-primary btn-block lg-submit" disabled={busy}>
              {busy && <span className="spinner lg-spin" />}
              {busy ? 'Aguarde…' : isRegister ? 'Criar conta e entrar' : 'Entrar'}
            </button>
          </form>

          <p className="lg-switch muted-text">
            {isRegister ? 'Já tem conta?' : 'Primeira vez aqui?'}{' '}
            <button type="button" className="link-btn lg-link" onClick={() => switchMode(isRegister ? 'login' : 'register')}>
              {isRegister ? 'Entrar' : 'Criar conta'}
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}

/** Tela mostrada enquanto restaura a sessão salva */
export function Splash() {
  const conn = useStore((s) => s.conn);
  const openSettings = useStore((s) => s.setSettingsOpen);
  const offline = conn === 'offline';
  return (
    <div className="screen splash">
      <div className="sp-card">
        <div className="sp-mark">
          <Decor />
        </div>
        <h1 className="sp-title">Mesa de Cartas</h1>
        {offline ? (
          <>
            <div className="sp-status sp-bad" role="status"><span className="conn-dot dot-bad" /> Sem conexão com o servidor</div>
            <code className="sp-url selectable">{getServerUrl()}</code>
            <p className="muted-text small">Continuando a tentar em segundo plano…</p>
            <div className="row-center">
              <button type="button" className="btn btn-primary" onClick={() => openSettings(true)}>Configurar servidor</button>
              <button type="button" className="btn btn-ghost" onClick={() => dropSession(null)}>Usar outra conta</button>
            </div>
          </>
        ) : (
          <div className="sp-status" role="status"><span className="spinner" /> Conectando ao servidor…</div>
        )}
      </div>
    </div>
  );
}
