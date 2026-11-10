import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientEvents, ServerEvents } from '@cards/shared';

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type ClientEventName = keyof ClientEvents;
export type EventPayload<E extends ClientEventName> = ClientEvents[E][0];
export type EventData<E extends ClientEventName> = ClientEvents[E][1];

type ListenEvents = { [K in keyof ServerEvents]: (payload: ServerEvents[K]) => void };
type EmitEvents = {
  [K in ClientEventName]: (payload: ClientEvents[K][0], ack: (res: Ack<ClientEvents[K][1]>) => void) => void;
};
export type TypedSocket = Socket<ListenEvents, EmitEvents>;

export const CALL_TIMEOUT_MS = 10_000;
export const ERR_TIMEOUT = 'O servidor não respondeu a tempo. Tente novamente.';
export const ERR_OFFLINE = 'Sem conexão com o servidor.';

/* ------------------------------------------------------------------ */
/* Configuração persistida (localStorage)                              */
/* ------------------------------------------------------------------ */

const LS_TOKEN = 'mesa.token';
const LS_URL = 'mesa.serverUrl';

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sem storage: segue sem persistir */
  }
}

/** Servidor oficial (API + jogo online) */
export const PUBLIC_SERVER_URL = 'https://cardgame.hchrist.com';

/**
 * Servidor padrão:
 * - página servida pelo próprio servidor do jogo (navegador ou app desktop): o mesmo endereço da página;
 * - Vite dev (porta 5173): servidor local na 4080;
 * - fora disso (ex.: arquivo local): servidor oficial.
 */
function defaultServerUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:4080`;
    return location.origin;
  }
  return PUBLIC_SERVER_URL;
}

export const DEFAULT_SERVER_URL: string = defaultServerUrl();

export function getServerUrl(): string {
  return lsGet(LS_URL) || DEFAULT_SERVER_URL;
}

/** Normaliza o que o usuário digitou: adiciona http:// se faltar e remove barra final */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export function getToken(): string | null {
  return lsGet(LS_TOKEN);
}
export function setToken(token: string | null): void {
  lsSet(LS_TOKEN, token);
}

export function getLastUsername(): string {
  return lsGet('mesa.lastUser') ?? '';
}
export function setLastUsername(name: string): void {
  lsSet('mesa.lastUser', name);
}

/* ------------------------------------------------------------------ */
/* Socket                                                              */
/* ------------------------------------------------------------------ */

let socket: TypedSocket | null = null;
/** Registros de listeners para reaplicar quando o socket é recriado (troca de servidor) */
const bindings: ((s: TypedSocket) => void)[] = [];

function createSocket(url: string): TypedSocket {
  const s: TypedSocket = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    // função: o token mais recente é lido a cada (re)conexão
    auth: (cb) => cb({ token: getToken() ?? undefined }),
  });
  // O servidor pode encerrar a conexão (ex.: kick); nesse caso o socket.io não reconecta sozinho
  s.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') setTimeout(() => s.connect(), 1000);
  });
  for (const bind of bindings) bind(s);
  return s;
}

export function getSocket(): TypedSocket {
  if (!socket) socket = createSocket(getServerUrl());
  return socket;
}

/** Registra uma função que liga listeners ao socket (agora e em qualquer socket futuro) */
export function bindSocket(bind: (s: TypedSocket) => void): void {
  bindings.push(bind);
  if (socket) bind(socket);
}

/** Troca a URL do servidor e reconecta */
export function changeServerUrl(input: string): string {
  const url = normalizeServerUrl(input);
  lsSet(LS_URL, url === DEFAULT_SERVER_URL ? null : url);
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  getSocket();
  return url;
}

/** Emite um evento e aguarda o Ack (timeout de 10 s). Nunca rejeita. */
export function call<E extends ClientEventName>(event: E, payload: EventPayload<E>): Promise<Ack<EventData<E>>> {
  return new Promise((resolve) => {
    const s = getSocket();
    if (!s.connected) {
      resolve({ ok: false, error: ERR_OFFLINE });
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, error: ERR_TIMEOUT });
    }, CALL_TIMEOUT_MS);
    try {
      (s as unknown as Socket).emit(event, payload, (res: Ack<EventData<E>>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res && typeof res === 'object' && 'ok' in res ? res : { ok: false, error: 'Resposta inválida do servidor.' });
      });
    } catch (err) {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err instanceof Error ? err.message : ERR_OFFLINE });
    }
  });
}

/** Espera o socket conectar (até `ms`). Retorna true se conectou. */
export function waitConnected(ms = CALL_TIMEOUT_MS): Promise<boolean> {
  const s = getSocket();
  if (s.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off('connect', onConnect);
      resolve(false);
    }, ms);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.once('connect', onConnect);
  });
}
