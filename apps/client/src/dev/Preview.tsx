/**
 * PRÉVIA DE DEV (só no `vite dev`): abre o app com dados de exemplo, sem servidor nem login.
 *   http://localhost:5173/?preview=<cena>[&tab=ranking|history|help|admin]
 * Cenas: login · lobby · lobby-vazio · criar-sala · sala-espera · sala-mesa · sala-mesa-espera · sala-jogo · sala-fim · configuracoes
 *   sala-espera/sala-mesa-espera aceitam &role=guest|spectator; qualquer sala aceita &drawer=chat|log|menu (abre a gaveta/menu)
 *   sala-mesa = Poker/Blackjack (use &game=blackjack), sala-jogo = partida em andamento (use &game=truco|copas|...)
 * As chamadas ao servidor são respondidas por um mock (setMockCall).
 */
import { useEffect, useState } from 'react';
import {
  createRng, isEngineError, resolveConfig, GAMES,
  type AnyEngine, type GameId, type Me, type RoomState, type RoomSummary, type SeatPlayer, type StepResult,
} from '@cards/shared';
import { ENGINES } from '@cards/games';
import { App } from '../App';
import { setMockCall } from '../net/socket';
import { useStore } from '../store';

const q = new URLSearchParams(location.search);
const scene = q.get('preview') || 'lobby';
const NOW = Date.now();

const ME: Me = {
  id: 'u0', username: 'henrique', role: 'admin', balance: 12_450, inPlay: 0,
  refillAvailableAt: null, dailyAvailableAt: null, roomId: null,
};

const ROOMS: RoomSummary[] = [
  { id: 'r1', name: 'Truco da firma', gameId: 'truco', isPrivate: false, hostName: 'ana', status: 'waiting', seatsTotal: 4, seatsTaken: 3, humans: 3, stakesLabel: 'Aposta 100', createdAt: NOW - 60_000 },
  { id: 'r2', name: 'Poker sexta', gameId: 'poker', isPrivate: false, hostName: 'beto', status: 'playing', seatsTotal: 6, seatsTaken: 5, humans: 4, stakesLabel: 'Blinds 10/20', createdAt: NOW - 3_600_000 },
  { id: 'r3', name: 'Blackjack', gameId: 'blackjack', isPrivate: false, hostName: 'carla', status: 'playing', seatsTotal: 7, seatsTaken: 2, humans: 2, stakesLabel: 'Aposta 10–10k', createdAt: NOW - 900_000 },
  { id: 'r4', name: 'Copas valendo', gameId: 'copas', isPrivate: false, hostName: 'duda', status: 'playing', seatsTotal: 4, seatsTaken: 4, humans: 2, stakesLabel: 'Aposta 500', createdAt: NOW - 1_200_000 },
  { id: 'r5', name: 'Fodinha', gameId: 'fodinha', isPrivate: true, hostName: 'edu', status: 'waiting', seatsTotal: 6, seatsTaken: 2, humans: 2, stakesLabel: 'Aposta 50', createdAt: NOW - 30_000 },
];

const RANKING = [
  ['henrique', 48_200, 41, 70], ['ana', 31_900, 30, 61], ['beto', 22_150, 18, 40], ['carla', 15_000, 12, 33],
  ['duda', 10_400, 9, 25], ['edu', 6_250, 4, 19], ['fabi', 1_300, 2, 15],
].map(([username, total, wins, played], i) => ({ userId: i === 0 ? 'u0' : `u${i}`, username, total, wins, played }));

const HISTORY = [
  ['poker', 'Poker sexta', 340, 'Ganhou 340 na Mão #12'], ['poker', 'Poker sexta', -120, 'Perdeu 120 na Mão #11'],
  ['truco', 'Truco da firma', 100, 'Dupla A venceu por 12 a 7'], ['blackjack', 'Blackjack', -50, 'Perdeu 50 na Rodada #4'],
  ['copas', 'Copas valendo', -500, 'ana venceu com a menor pontuação'], ['cacheta', 'Cacheta', 300, 'henrique venceu a Cacheta'],
].map(([gameId, roomName, net, summary], i) => ({ id: `h${i}`, gameId, roomName, net, summary, endedAt: NOW - i * 1_800_000 }));

const ADMIN_USERS = RANKING.map((r, i) => ({
  id: r.userId, username: r.username, role: i === 0 ? 'admin' : 'user', balance: r.total, inPlay: i === 1 ? 2000 : 0,
  banned: i === 6, createdAt: NOW - 86_400_000 * (i + 1), lastSeenAt: NOW - i * 600_000, online: i < 3,
}));

function mock(event: string): { ok: true; data: any } | { ok: false; error: string } {
  switch (event) {
    case 'lobby:list': return { ok: true, data: scene === 'lobby-vazio' ? [] : ROOMS };
    case 'ranking:get': return { ok: true, data: RANKING };
    case 'history:get': return { ok: true, data: HISTORY };
    case 'admin:users': return { ok: true, data: ADMIN_USERS };
    case 'admin:rooms': return { ok: true, data: ROOMS };
    case 'me:get': return { ok: true, data: ME };
    default: return { ok: false, error: '(prévia: sem servidor)' };
  }
}

const NAMES = ['henrique', 'ana', 'beto', 'carla', 'duda', 'edu', 'fabi'];

/** Roda o motor com bots até ser a vez do assento 0 (para a cena de jogo ter cartas reais) */
function simulate(gameId: GameId, players: number, steps: number) {
  const engine = ENGINES[gameId] as AnyEngine;
  const rng = createRng(Number(q.get('seed')) || 5);
  const ctx = () => ({ rng, now: Date.now() });
  const config = resolveConfig(gameId, { players, seats: players, turnSeconds: 30 });
  const n = GAMES[gameId].economy === 'session' ? players : config.players;
  const seatPlayers: SeatPlayer[] = Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: NAMES[i], isBot: i >= 2 }));
  let state: any;
  let pending = false;
  const take = (r: StepResult<any>) => { state = r.state; if (r.advanceInMs !== undefined) pending = true; };
  if (engine.economy === 'session') {
    state = engine.create(config, ctx());
    seatPlayers.forEach((p, i) => { const r = engine.sitDown(state, i, p, config.maxBuyIn, ctx()); if (!isEngineError(r)) take(r); });
  } else take(engine.create(config, seatPlayers, ctx()));
  for (let i = 0; i < steps; i++) {
    const turn = engine.getTurn(state);
    if (turn.seats.length) {
      if (turn.seats.includes(0) && i > 2) break;
      const seat = turn.seats.find((s) => s !== 0) ?? turn.seats[0];
      const r = engine.applyAction(state, seat, engine.botAction(state, seat, ctx()), ctx());
      if (isEngineError(r)) break;
      take(r);
    } else if (pending) { pending = false; take(engine.advance(state, ctx())); } else break;
  }
  return { engine, state, config, seatPlayers };
}

function roomState(gameId: GameId, status: RoomState['status'], seats: RoomState['seats'], config: Record<string, number>): RoomState {
  return {
    id: 'rx', code: 'K7QX2M', name: gameId === 'truco' ? 'Truco da firma' : `Mesa de ${GAMES[gameId].name}`, gameId,
    isPrivate: false, hostUserId: 'u0', status, config, seats,
    spectators: [{ userId: 'u9', name: 'gabi' }], lastResult: null, autoStartAt: null,
  };
}

/** &desktop=1: simula a API do Electron (botões de janela, sempre no topo, opacidade, atalho) */
function fakeDesktop() {
  let cur = { alwaysOnTop: true, opacity: 0.9, hotkey: 'CommandOrControl+Shift+Space', hotkeyError: null as string | null };
  const push = () => useStore.getState().setDesktop({ ...cur });
  window.desktop = {
    minimize() {}, hide() {}, quit() {},
    getSettings: async () => ({ ...cur }),
    setAlwaysOnTop: async (v) => { cur = { ...cur, alwaysOnTop: v }; push(); },
    setOpacity: async (v) => { cur = { ...cur, opacity: v }; push(); },
    setHotkey: async (a) => { cur = { ...cur, hotkey: a }; push(); return { ok: true }; },
    onSettingsChanged: () => () => {},
  };
  push();
}

function setupScene() {
  setMockCall((event) => mock(event));
  if (q.get('desktop')) fakeDesktop();
  const st = useStore.getState();
  useStore.setState({ booting: false, conn: 'online' });
  if (scene === 'splash' || scene === 'splash-offline') {
    useStore.setState({ booting: true, conn: scene === 'splash' ? 'connecting' : 'offline' });
    return;
  }
  if (scene === 'login') return;
  st.setMe(ME);
  if (scene === 'configuracoes') useStore.setState({ settingsOpen: true });
  if (scene === 'toasts') {
    st.toast('success', 'Saldo de ana ajustado.');
    st.toast('error', 'Não foi possível entrar na sala: ela está cheia no momento.');
    st.toast('info', 'Servidor: https://cardgame.hchrist.com');
  }
  if (scene.startsWith('lobby') || scene === 'criar-sala' || scene === 'toasts' || scene === 'confirmar' || scene === 'configuracoes') {
    st.setRooms(scene === 'lobby-vazio' ? [] : ROOMS);
    return;
  }
  const gameId = (q.get('game') as GameId) || (scene === 'sala-mesa' || scene === 'sala-mesa-espera' ? 'poker' : 'truco');
  if (scene === 'sala-espera' || scene === 'sala-mesa-espera') {
    const session = GAMES[gameId].economy === 'session';
    const role = q.get('role') || 'host';
    const config = session ? resolveConfig(gameId, { players: 6, seats: 6 }) : resolveConfig(gameId, { players: 4 });
    const p = (seat: number, userId: string, name: string, ready: boolean, extra: Partial<SeatPlayer & { connected: boolean }> = {}) =>
      ({ seat, userId, name, isBot: false, connected: true, ready, ...extra });
    let seats: RoomState['seats'];
    let hostUserId = 'u0';
    let spectators: RoomState['spectators'] = [{ userId: 'u9', name: 'gabi' }];
    if (role === 'guest') {
      hostUserId = 'u1';
      seats = [p(0, 'u1', 'ana', true), p(1, 'u2', 'beto', true, { connected: false }), p(2, 'u0', 'henrique', false), null];
    } else if (role === 'spectator') {
      hostUserId = 'u1';
      seats = [p(0, 'u1', 'ana', true), p(1, 'u2', 'beto', false), p(2, 'u3', 'carla', true), null];
      spectators = [{ userId: 'u0', name: 'henrique' }, { userId: 'u9', name: 'gabi' }];
    } else {
      seats = [p(0, 'u0', 'henrique', false), p(1, 'u1', 'ana', true), p(2, 'u2', 'beto', false), null];
    }
    if (session) seats = [...seats, { seat: 4, userId: 'bot1', name: 'Bot 1', isBot: true, connected: true, ready: true }, null].slice(0, 6) as RoomState['seats'];
    st.setRoom({ ...roomState(gameId, 'waiting', seats, config), hostUserId, spectators, autoStartAt: session || scene === 'sala-mesa-espera' ? null : Date.now() + 23_000 });
    for (const [name, text] of [['ana', 'bora que essa é nossa'], ['beto', 'só falta o henrique ficar pronto, ele está lendo o tutorial de novo'], ['ana', 'kkkk']]) {
      st.addChat({ id: `${name}${text}`, roomId: 'rx', userId: name, name, text, at: Date.now() - 60_000 }, false);
    }
  } else {
    const players = gameId === 'truco' || gameId === 'sueca' || gameId === 'copas' ? 4 : 5;
    const sim = simulate(gameId, players, 300);
    const seats = sim.seatPlayers.map((p, i) => ({ seat: i, userId: p.userId, name: p.name, isBot: p.isBot, connected: i !== 1, ready: true }));
    const finished = scene === 'sala-fim';
    st.setRoom({ ...roomState(gameId, finished ? 'finished' : 'playing', seats, sim.config), lastResult: finished ? { summary: 'Dupla A venceu por 12 a 7', winners: [0, 2], payoutEach: 200 } : null });
    const turn = sim.engine.getTurn(sim.state);
    st.applyGameView({ roomId: 'rx', view: sim.engine.getView(sim.state, 0), mySeat: 0, turn: { seats: turn.seats, deadline: turn.seats.length ? Date.now() + 18_000 : null }, seq: 1 });
    useStore.setState({ me: { ...ME, inPlay: GAMES[gameId].economy === 'session' ? sim.config.maxBuyIn : 100 } });
    for (const [name, text] of [['ana', 'bora que essa é nossa'], ['beto', 'truco nele!'], ['ana', 'kkkk']]) {
      st.addChat({ id: `${name}${text}`, roomId: 'rx', userId: name, name, text, at: Date.now() }, false);
    }
  }
  if (!q.get('pops')) useStore.setState({ chatPops: [] }); // balões de chat só com &pops=1
  if (q.get('drawer') === 'log') {
    [['Mão #3 começou.', 'hand_start'], ['ana apostou 20.', ''], ['beto pagou 20.', ''], ['Flop: 7♣ K♥ 2♦', ''], ['henrique deu check.', ''], ['ana apostou 60.', ''], ['henrique desistiu.', '']]
      .forEach(([text, type]) => st.pushLog({ text, type: type || undefined }));
  }
}

export function Preview() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setupScene();
    setReady(true);
    const drawer = q.get('drawer');
    if (drawer) setTimeout(() => {
      if (drawer === 'chat') useStore.getState().setChatOpen(true);
      const label = drawer === 'log' ? 'Histórico da mesa' : drawer === 'menu' ? 'Mais opções' : '';
      if (label) document.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
    }, 400);
    if (scene === 'confirmar') {
      void import('../ui/dialogs').then(({ askConfirm }) => askConfirm({ title: 'Banir usuário', message: 'beto será desconectado e não poderá entrar.', confirmLabel: 'Banir', danger: true }));
    }
    if (scene === 'criar-sala') {
      // abre o modal de criar sala clicando no botão (a cena é o lobby com o modal aberto)
      setTimeout(() => [...document.querySelectorAll('button')].find((b) => /criar sala/i.test(b.textContent ?? ''))?.click(), 300);
    }
  }, []);
  return ready ? <App offline /> : null;
}
