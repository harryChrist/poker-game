import { create } from 'zustand';
import { GAMES, type ChatMsg, type GameViewMsg, type Me, type RoomState, type RoomSummary } from '@cards/shared';
import type { DesktopSettings } from './desktop';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type ToastKind = 'info' | 'error' | 'success';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface LogLine {
  id: number;
  text: string;
  seat?: number;
  at: number;
  /** tipo do evento do motor (ex.: 'hand_start' vira separador no histórico) */
  type?: string;
}

export interface ChatPop {
  id: number;
  name: string;
  text: string;
}

const MAX_CHAT = 100;
const MAX_LOG = 40;
const MAX_HISTORY = 300;
const MAX_POPS = 3;
const MAX_TOASTS = 4;

let nextId = 1;

interface Store {
  conn: ConnState;
  /** true enquanto restaura a sessão salva (token) ao abrir o app */
  booting: boolean;
  me: Me | null;
  /** Mensagem exibida na tela de login (ex.: kick, sessão expirada) */
  loginNotice: string | null;

  rooms: RoomSummary[];
  room: RoomState | null;
  gameView: GameViewMsg | null;

  chat: ChatMsg[];
  unread: number;
  chatOpen: boolean;
  log: LogLine[];
  /** Histórico da mesa (últimas ~300 linhas da sala atual) */
  history: LogLine[];
  /** Balões de chat (chat fechado) */
  chatPops: ChatPop[];
  /** Última linha de evento de jogo (aparece por alguns segundos sobre a mesa) */
  ticker: LogLine | null;

  toasts: Toast[];
  settingsOpen: boolean;
  desktop: DesktopSettings | null;

  setConn(conn: ConnState): void;
  setBooting(v: boolean): void;
  setMe(me: Me): void;
  setLoginNotice(text: string | null): void;
  setRooms(rooms: RoomSummary[]): void;
  setRoom(room: RoomState | null): void;
  applyGameView(msg: GameViewMsg): void;
  setChatHistory(msgs: ChatMsg[]): void;
  addChat(msg: ChatMsg, mine: boolean): void;
  setChatOpen(open: boolean): void;
  pushLog(line: Omit<LogLine, 'id' | 'at'>): void;
  dismissChatPop(id: number): void;
  toast(kind: ToastKind, text: string): void;
  dismissToast(id: number): void;
  setSettingsOpen(open: boolean): void;
  setDesktop(s: DesktopSettings | null): void;
  /** Volta ao estado "deslogado" */
  resetSession(notice?: string | null): void;
}

export const useStore = create<Store>()((set, get) => ({
  conn: 'connecting',
  booting: false,
  me: null,
  loginNotice: null,

  rooms: [],
  room: null,
  gameView: null,

  chat: [],
  unread: 0,
  chatOpen: false,
  log: [],
  history: [],
  chatPops: [],
  ticker: null,

  toasts: [],
  settingsOpen: false,
  desktop: null,

  setConn: (conn) => set({ conn }),
  setBooting: (booting) => set({ booting }),
  setMe: (me) => set({ me }),
  setLoginNotice: (loginNotice) => set({ loginNotice }),
  setRooms: (rooms) => set({ rooms }),

  setRoom: (room) =>
    set((s) => {
      if (!room) {
        return { room: null, gameView: null, chat: [], unread: 0, chatOpen: false, log: [], history: [], chatPops: [], ticker: null };
      }
      const changed = s.room?.id !== room.id;
      let gameView = s.gameView?.roomId === room.id ? s.gameView : null;
      // Partida (match) voltou ao estado de espera, ou recomeçou depois de finalizada: a visão antiga não vale mais
      if (!changed && GAMES[room.gameId].economy === 'match') {
        const prev = s.room?.status;
        if (room.status === 'waiting' || (prev === 'finished' && room.status === 'playing')) gameView = null;
      }
      return {
        room,
        gameView,
        chat: s.chat.filter((m) => m.roomId === room.id),
        unread: changed ? 0 : s.unread,
        chatOpen: changed ? false : s.chatOpen,
        log: changed ? [] : s.log,
        history: changed ? [] : s.history,
        chatPops: changed ? [] : s.chatPops,
        ticker: changed ? null : s.ticker,
      };
    }),

  applyGameView: (msg) =>
    set((s) => {
      const cur = s.gameView;
      if (cur && cur.roomId === msg.roomId && msg.seq <= cur.seq) return {};
      return { gameView: msg };
    }),

  setChatHistory: (msgs) => set((s) => ({ chat: msgs.slice(-MAX_CHAT), unread: s.chatOpen ? 0 : s.unread })),

  addChat: (msg, mine) =>
    set((s) => {
      if (s.chat.some((m) => m.id === msg.id)) return {};
      const chat = [...s.chat, msg].slice(-MAX_CHAT);
      const countsAsUnread = !s.chatOpen && !mine && !msg.system;
      const pop = countsAsUnread && s.room?.id === msg.roomId;
      return {
        chat,
        unread: countsAsUnread ? s.unread + 1 : s.unread,
        chatPops: pop ? [...s.chatPops, { id: nextId++, name: msg.name, text: msg.text }].slice(-MAX_POPS) : s.chatPops,
      };
    }),

  setChatOpen: (chatOpen) => set((s) => ({ chatOpen, unread: chatOpen ? 0 : s.unread, chatPops: chatOpen ? [] : s.chatPops })),

  pushLog: (line) =>
    set((s) => {
      const entry: LogLine = { ...line, id: nextId++, at: Date.now() };
      return {
        log: [...s.log, entry].slice(-MAX_LOG),
        history: [...s.history, entry].slice(-MAX_HISTORY),
        ticker: line.type === 'hand_start' ? s.ticker : entry,
      };
    }),
  dismissChatPop: (id) => set((s) => ({ chatPops: s.chatPops.filter((p) => p.id !== id) })),

  toast: (kind, text) =>
    set((s) => {
      // evita empilhar mensagens idênticas (ex.: erro mostrado pelo app e pela tela do jogo)
      if (s.toasts.some((t) => t.text === text)) return {};
      return { toasts: [...s.toasts, { id: nextId++, kind, text }].slice(-MAX_TOASTS) };
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setDesktop: (desktop) => set({ desktop }),

  resetSession: (notice = null) => {
    const { conn, desktop } = get();
    set({
      conn, desktop,
      booting: false,
      me: null,
      loginNotice: notice,
      rooms: [],
      room: null,
      gameView: null,
      chat: [],
      unread: 0,
      chatOpen: false,
      log: [],
      history: [],
      chatPops: [],
      ticker: null,
      toasts: [],
      settingsOpen: false,
    });
  },
}));
