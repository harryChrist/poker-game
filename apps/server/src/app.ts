import { createServer, type Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  GAMES,
  type AdminUser, type AnyEngine, type ClientEvents, type GameId, type ServerEventName, type ServerEvents,
} from '@cards/shared';
import { Auth } from './auth';
import { serveStatic } from './static';
import { handleDeployWebhook, readBuildId } from './deploy';
import { fail, UserError, type Config } from './config';
import { openDb, type Db } from './db';
import type { ManagerTransport } from './rooms';
import { RoomManager } from './rooms';
import { Wallet, type UserRow } from './wallet';

export interface AppOptions {
  config: Config;
  engines: Record<GameId, AnyEngine>;
  db?: Db;
  rng?: () => number;
  rand?: () => number;
  log?: (msg: string, err?: unknown) => void;
  /** Silencia o log informativo (testes) */
  quiet?: boolean;
}

export interface App {
  httpServer: HttpServer;
  io: Server;
  db: Db;
  wallet: Wallet;
  auth: Auth;
  rooms: RoomManager;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

// ---------- schemas ----------
const gameIdSchema = z.enum(Object.keys(GAMES) as [GameId, ...GameId[]]);
const str = (max: number) => z.string().max(max);
const emptySchema = z.object({});
const idSchema = str(100);
const seatSchema = z.number().int().min(0).max(30);

const schemas: { [K in keyof ClientEvents]: z.ZodType<ClientEvents[K][0]> } = {
  'auth:register': z.object({ username: str(64), password: str(300) }),
  'auth:login': z.object({ username: str(64), password: str(300) }),
  'auth:logout': emptySchema,
  'me:get': emptySchema,
  'wallet:refill': emptySchema,
  'wallet:daily': emptySchema,
  'lobby:list': z.object({ gameId: gameIdSchema.optional() }),
  'room:create': z.object({
    gameId: gameIdSchema,
    name: str(200),
    isPrivate: z.boolean().default(false),
    config: z.record(z.string().max(40), z.number()).default({}),
  }),
  'room:join': z.object({ roomId: idSchema.optional(), code: str(20).optional() }),
  'room:leave': emptySchema,
  'room:sit': z.object({ seat: seatSchema, buyIn: z.number().int().min(0).max(1e12).optional() }),
  'room:stand': emptySchema,
  'room:addChips': z.object({ amount: z.number().int().min(0).max(1e12) }),
  'room:addBot': z.object({ seat: seatSchema }),
  'room:removeBot': z.object({ seat: seatSchema }),
  'room:start': emptySchema,
  'game:action': z.object({ action: z.unknown() }).refine((v) => JSON.stringify(v.action ?? null).length <= 4000),
  'chat:send': z.object({ text: str(2000) }),
  'ranking:get': emptySchema,
  'history:get': emptySchema,
  'admin:users': z.object({ search: str(50).optional() }),
  'admin:adjust': z.object({ userId: idSchema, amount: z.number().int().min(-1e9).max(1e9) }),
  'admin:setRole': z.object({ userId: idSchema, role: z.enum(['user', 'admin']) }),
  'admin:ban': z.object({ userId: idSchema, banned: z.boolean() }),
  'admin:resetPassword': z.object({ userId: idSchema, password: str(300) }),
  'admin:rooms': emptySchema,
  'admin:closeRoom': z.object({ roomId: idSchema }),
};

const FLOOD_MAX = 100;
const FLOOD_WINDOW_MS = 10_000;

export function createApp(opts: AppOptions): App {
  const { config, engines } = opts;
  const log = opts.log ?? ((m: string, e?: unknown) => console.error(`[server] ${m}`, e ?? ''));
  const info = (m: string) => {
    if (!opts.quiet) console.log(`[server] ${m}`);
  };

  const db = opts.db ?? openDb(config.dbPath);
  const wallet = new Wallet(db, config);
  const auth = new Auth(wallet);

  // O servidor caiu/reiniciou: devolve tudo que estava preso em mesas e partidas
  const refunded = wallet.returnAllEscrow();
  if (refunded > 0) info(`escrow devolvido a ${refunded} usuário(s)`);

  const httpServer = createServer((req, res) => {
    if (req.url === '/health' || req.url?.startsWith('/health?')) {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()), online: sockets.size, rooms: rooms.count }));
      return;
    }
    if (handleDeployWebhook(req, res, config.deploy, info)) return;
    if (serveStatic(req, res, config.publicDir, config.desktopDir)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Mesa de Cartas — não encontrado');
  });

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 100_000,
  });

  /** userId -> socket (um por usuário) */
  const sockets = new Map<string, Socket>();

  const transport: ManagerTransport = {
    send<E extends ServerEventName>(userId: string, event: E, payload: ServerEvents[E]) {
      sockets.get(userId)?.emit(event as string, payload);
    },
    onlineUsers: () => sockets.keys(),
  };

  const rooms = new RoomManager({ wallet, transport, engines, rng: opts.rng, rand: opts.rand, log });

  // ---------- sessão do socket ----------
  function attach(socket: Socket, user: UserRow, token: string, emitMe: boolean) {
    detach(socket, true);
    const old = sockets.get(user.id);
    if (old && old !== socket) {
      old.data.userId = null;
      old.emit('kicked', { reason: 'Conectado em outro lugar' });
      old.disconnect(true);
    }
    sockets.set(user.id, socket);
    socket.data.userId = user.id;
    socket.data.token = token;
    wallet.touch(user.id);
    if (emitMe) socket.emit('me', wallet.buildMe(user.id, rooms.roomIdOf(user.id)));
    rooms.onConnect(user.id);
  }

  /** Desassocia o socket do usuário atual. `keepRoom`: não sai da sala (troca de conta / reconexão). */
  function detach(socket: Socket, keepRoom: boolean) {
    const id = socket.data.userId as string | null | undefined;
    if (!id) return;
    socket.data.userId = null;
    socket.data.token = null;
    if (sockets.get(id) === socket) {
      sockets.delete(id);
      if (keepRoom) rooms.onDisconnect(id);
      else rooms.leave(id);
      wallet.touch(id);
    }
  }

  function kickUser(userId: string, reason: string) {
    const s = sockets.get(userId);
    rooms.leave(userId);
    if (s) {
      s.data.userId = null;
      sockets.delete(userId);
      s.emit('kicked', { reason });
      s.disconnect(true);
    }
  }

  function adminUser(u: UserRow): AdminUser {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      balance: u.balance,
      inPlay: wallet.escrowOf(u.id),
      banned: !!u.banned,
      createdAt: u.created_at,
      lastSeenAt: u.last_seen_at,
      online: sockets.has(u.id),
    };
  }

  function ipOf(socket: Socket): string {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || socket.handshake.address || 'unknown';
  }

  // ---------- registro de handlers ----------
  type Need = 'none' | 'user' | 'admin';
  type Handler<E extends keyof ClientEvents> = (p: ClientEvents[E][0], user: UserRow, socket: Socket) => ClientEvents[E][1] | Promise<ClientEvents[E][1]>;

  // Versão da web app em disco: o cliente compara com a dele e recarrega se mudou (deploy novo)
  const buildId = readBuildId(config.publicDir);

  io.on('connection', (socket) => {
    const flood: number[] = [];
    socket.emit('server:hello', { buildId });

    const on = <E extends keyof ClientEvents>(event: E, need: Need, fn: Handler<E>) => {
      socket.on(event as string, async (raw: unknown, ack?: unknown) => {
        const reply = (r: unknown) => {
          if (typeof ack === 'function') ack(r);
        };
        try {
          const now = Date.now();
          while (flood.length && now - flood[0] > FLOOD_WINDOW_MS) flood.shift();
          if (flood.length >= FLOOD_MAX) fail('Muitas requisições. Aguarde um instante.');
          flood.push(now);

          const parsed = schemas[event].safeParse(raw ?? {});
          if (!parsed.success) fail('Dados inválidos.');
          let user: UserRow | null = null;
          if (need !== 'none') {
            const id = socket.data.userId as string | null | undefined;
            if (!id) fail('Faça login primeiro.');
            user = wallet.getUser(id) ?? null;
            if (!user || user.banned) fail('Sessão inválida. Entre novamente.');
            if (need === 'admin' && user.role !== 'admin') fail('Acesso restrito a administradores.');
          }
          const data = await fn(parsed.data as never, user as UserRow, socket);
          reply({ ok: true, data });
        } catch (e) {
          if (e instanceof UserError) reply({ ok: false, error: e.message });
          else {
            log(`erro em ${event}`, e);
            reply({ ok: false, error: 'Erro interno do servidor.' });
          }
        }
      });
    };

    const me = (u: UserRow) => wallet.buildMe(u.id, rooms.roomIdOf(u.id));

    // --- conexão com token ---
    const token = socket.handshake.auth?.token;
    if (token) {
      const u = auth.verifyToken(token);
      if (u) attach(socket, u, token as string, true);
      else socket.emit('kicked', { reason: 'Sessão expirada. Entre novamente.' });
    }

    // --- auth ---
    on('auth:register', 'none', async ({ username, password }, _u, s) => {
      const { token, user } = await auth.register(username, password, ipOf(s));
      attach(s, user, token, false);
      return { token, me: me(user) };
    });
    on('auth:login', 'none', async ({ username, password }, _u, s) => {
      const { token, user } = await auth.login(username, password, ipOf(s));
      attach(s, user, token, false);
      return { token, me: me(user) };
    });
    on('auth:logout', 'none', (_p, _u, s) => {
      const t = s.data.token as string | undefined;
      if (t) auth.logout(t);
      detach(s, false);
      return undefined;
    });

    // --- carteira ---
    on('me:get', 'user', (_p, u) => me(u));
    on('wallet:refill', 'user', (_p, u) => {
      wallet.refill(u.id, rooms.isInPlay(u.id));
      return me(u);
    });
    on('wallet:daily', 'user', (_p, u) => {
      wallet.daily(u.id);
      return me(u);
    });

    // --- lobby / salas ---
    on('lobby:list', 'user', ({ gameId }) => rooms.listPublic(gameId));
    on('room:create', 'user', (p, u) => rooms.createRoom({ id: u.id, name: u.username }, p));
    on('room:join', 'user', (p, u) => rooms.join({ id: u.id, name: u.username }, p));
    on('room:leave', 'user', (_p, u) => {
      rooms.leave(u.id);
      return undefined;
    });
    on('room:sit', 'user', ({ seat, buyIn }, u) => {
      rooms.sit(u.id, seat, buyIn);
      return undefined;
    });
    on('room:stand', 'user', (_p, u) => {
      rooms.stand(u.id);
      return undefined;
    });
    on('room:addChips', 'user', ({ amount }, u) => {
      rooms.addChips(u.id, amount);
      return undefined;
    });
    on('room:addBot', 'user', ({ seat }, u) => {
      rooms.addBot(u.id, seat);
      return undefined;
    });
    on('room:removeBot', 'user', ({ seat }, u) => {
      rooms.removeBot(u.id, seat);
      return undefined;
    });
    on('room:start', 'user', (_p, u) => {
      rooms.start(u.id);
      return undefined;
    });
    on('game:action', 'user', ({ action }, u) => {
      rooms.action(u.id, action);
      return undefined;
    });
    on('chat:send', 'user', ({ text }, u) => {
      rooms.chat(u.id, text);
      return undefined;
    });

    // --- ranking / histórico ---
    on('ranking:get', 'user', () => wallet.ranking(50));
    on('history:get', 'user', (_p, u) => wallet.history(u.id, 50));

    // --- admin ---
    on('admin:users', 'admin', ({ search }) => {
      const q = (search ?? '').trim();
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = q
        ? db.all<UserRow>("SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username COLLATE NOCASE LIMIT 200", like)
        : db.all<UserRow>('SELECT * FROM users ORDER BY username COLLATE NOCASE LIMIT 200');
      return rows.map(adminUser);
    });
    on('admin:adjust', 'admin', ({ userId, amount }, admin) => {
      if (amount === 0) fail('Informe um valor diferente de zero.');
      wallet.requireUser(userId);
      wallet.adjust(userId, amount, `admin:${admin.username}`);
      rooms.pushMe(userId);
      return adminUser(wallet.requireUser(userId));
    });
    on('admin:setRole', 'admin', ({ userId, role }, admin) => {
      const target = wallet.requireUser(userId);
      if (target.role === 'admin' && role !== 'admin') {
        const admins = db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND banned = 0")!.c;
        if (admins <= 1) fail('Não é possível remover o único administrador.');
      }
      db.run('UPDATE users SET role = ? WHERE id = ?', role, userId);
      rooms.pushMe(userId);
      log(`${admin.username} definiu o papel de ${target.username} como ${role}`);
      return adminUser(wallet.requireUser(userId));
    });
    on('admin:ban', 'admin', ({ userId, banned }, admin) => {
      if (userId === admin.id) fail('Você não pode banir a si mesmo.');
      wallet.requireUser(userId);
      db.run('UPDATE users SET banned = ? WHERE id = ?', banned ? 1 : 0, userId);
      if (banned) {
        auth.revokeSessions(userId);
        kickUser(userId, 'Sua conta foi banida.');
      }
      return adminUser(wallet.requireUser(userId));
    });
    on('admin:resetPassword', 'admin', async ({ userId, password }) => {
      await auth.resetPassword(userId, password);
      kickUser(userId, 'Sua senha foi redefinida. Entre novamente.');
      return undefined;
    });
    on('admin:rooms', 'admin', () => rooms.listAll());
    on('admin:closeRoom', 'admin', ({ roomId }) => {
      rooms.closeRoom(roomId, 'A sala foi fechada por um administrador.');
      return undefined;
    });

    socket.on('disconnect', () => {
      // se outro socket já assumiu a conta, data.userId foi zerado e nada acontece aqui
      detach(socket, true);
    });
  });

  const maintenance = setInterval(() => {
    try {
      auth.sweep();
    } catch (e) {
      log('erro na manutenção', e);
    }
  }, 10 * 60_000);
  maintenance.unref();

  let closed = false;

  return {
    httpServer, io, db, wallet, auth, rooms,
    listen(port = config.port) {
      return new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          const addr = httpServer.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(maintenance);
      rooms.shutdown();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      db.close();
    },
  };
}
