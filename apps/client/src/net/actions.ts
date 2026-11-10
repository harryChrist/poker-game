import type { Ack, GameId } from '@cards/shared';
import { useStore } from '../store';
import {
  ERR_OFFLINE, ERR_TIMEOUT, bindSocket, call, changeServerUrl, getServerUrl, getSocket, getToken, setLastUsername, setToken, waitConnected,
  type ClientEventName, type EventData, type EventPayload, type TypedSocket,
} from './socket';

const store = () => useStore.getState();

let started = false;
let hasConnectedBefore = false;

/** Liga o socket ao store. Chamar uma vez ao iniciar o app. */
export function initNet(): void {
  if (started) return;
  started = true;

  store().setBooting(!!getToken());
  bindSocket(bindEvents);
  getSocket();
  void initDesktop();
}

/**
 * Atualização automática da web app (navegador e app desktop): o servidor informa a versão que está servindo.
 * Se for outra, recarrega a página para pegar o código novo. Guarda no sessionStorage para nunca entrar em loop.
 */
function reloadIfOutdated(serverBuild: string | null): void {
  if (import.meta.env.DEV || !serverBuild || serverBuild === __BUILD_ID__) return;
  const key = 'mesa.reloadedFor';
  try {
    if (sessionStorage.getItem(key) === serverBuild) return;
    sessionStorage.setItem(key, serverBuild);
  } catch {
    return;
  }
  location.reload();
}

function bindEvents(s: TypedSocket): void {
  s.on('connect', () => {
    store().setConn('online');
    const reconnect = hasConnectedBefore;
    hasConnectedBefore = true;
    void onConnected(reconnect);
  });
  s.on('disconnect', () => store().setConn('reconnecting'));
  s.on('connect_error', () => store().setConn('offline'));
  s.io.on('reconnect_attempt', () => {
    if (store().conn !== 'offline') store().setConn('reconnecting');
  });

  s.on('server:hello', ({ buildId }) => reloadIfOutdated(buildId));
  s.on('me', (me) => store().setMe(me));
  s.on('lobby:rooms', (rooms) => store().setRooms(rooms));
  s.on('room:state', (room) => store().setRoom(room));
  s.on('room:left', (info) => {
    const st = store();
    if (st.room && st.room.id !== info.roomId) return;
    st.setRoom(null);
    if (info.reason) st.toast('info', info.reason);
  });
  s.on('game:view', (msg) => store().applyGameView(msg));
  s.on('game:events', (msg) => {
    for (const ev of msg.events) {
      if (ev.text) store().pushLog({ text: ev.text, seat: ev.seat });
    }
  });
  s.on('chat:msg', (msg) => store().addChat(msg, msg.userId === store().me?.id));
  s.on('chat:history', (msgs) => store().setChatHistory(msgs));
  s.on('notice', (n) => store().toast(n.kind, n.text));
  s.on('kicked', (k) => dropSession(k.reason || 'Sua sessão foi encerrada.'));
}

/** Após (re)conectar: valida o token salvo e restaura a sessão */
async function onConnected(reconnect: boolean): Promise<void> {
  if (!getToken()) {
    store().setBooting(false);
    return;
  }
  const res = await call('me:get', {});
  if (res.ok) {
    store().setMe(res.data);
    if (reconnect && !res.data.roomId && store().room) store().setRoom(null);
    store().setBooting(false);
    return;
  }
  // Token recusado de fato (e não apenas falha de rede): volta ao login
  if (res.error !== ERR_TIMEOUT && res.error !== ERR_OFFLINE) {
    dropSession(store().me ? 'Sessão expirada. Entre novamente.' : null);
  } else {
    store().setBooting(false);
  }
}

/** Esquece o token e volta para a tela de login */
export function dropSession(notice: string | null = null): void {
  setToken(null);
  store().resetSession(notice);
}

async function initDesktop(): Promise<void> {
  const d = window.desktop;
  if (!d) return;
  try {
    const first = await d.getSettings();
    store().setDesktop(first);
    if (first.hotkeyError) store().toast('error', `Atalho global indisponível: ${first.hotkeyError}`);
  } catch {
    /* sem desktop */
  }
  d.onSettingsChanged((s) => store().setDesktop(s));
}

/* ------------------------------------------------------------------ */
/* Ações de alto nível                                                 */
/* ------------------------------------------------------------------ */

/** Chama o servidor e mostra um toast de erro automaticamente (a menos que `silent`) */
export async function act<E extends ClientEventName>(
  event: E,
  payload: EventPayload<E>,
  opts: { silent?: boolean } = {},
): Promise<Ack<EventData<E>>> {
  const res = await call(event, payload);
  if (!res.ok && !opts.silent) store().toast('error', res.error);
  return res;
}

/** Login ou cadastro. Retorna mensagem de erro, ou null em sucesso. */
export async function authenticate(
  mode: 'login' | 'register',
  username: string,
  password: string,
  serverUrl: string,
): Promise<string | null> {
  const wanted = serverUrl.trim();
  if (wanted && wanted.replace(/\/+$/, '') !== getServerUrl()) {
    changeServerUrl(wanted);
  }
  if (!(await waitConnected(8000))) {
    return `Não foi possível conectar a ${getServerUrl()}. Verifique o endereço do servidor.`;
  }
  const res = await call(mode === 'login' ? 'auth:login' : 'auth:register', { username, password });
  if (!res.ok) return res.error;
  setToken(res.data.token);
  setLastUsername(username);
  const st = store();
  st.setLoginNotice(null);
  st.setMe(res.data.me);
  st.setBooting(false);
  void refreshLobby();
  return null;
}

export async function logout(): Promise<void> {
  await call('auth:logout', {});
  dropSession(null);
}

export async function refreshLobby(gameId?: GameId): Promise<void> {
  const res = await call('lobby:list', gameId ? { gameId } : {});
  if (res.ok) store().setRooms(res.data);
}

/** Troca a URL do servidor a partir das configurações (mantém a sessão se o token for aceito pelo novo servidor) */
export function applyServerUrl(url: string): string {
  const normalized = changeServerUrl(url);
  store().setConn('connecting');
  return normalized;
}
