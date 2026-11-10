/**
 * Galeria DEV (só existe no `vite dev`): renderiza a tela de cada jogo rodando o motor no próprio navegador,
 * sem servidor. Você é o assento 0; bots jogam o resto. Dá para jogar clicando normalmente.
 *
 *   http://localhost:5173/?gallery=poker&size=sm
 *   params: gallery=<gameId|all>  size=sm|md|lg (ou w=..&h=..)  players=N  seed=N  stop=turn|none  steps=N
 *   sm = 340x390 (área de jogo na janela mínima), md = 420x570 (janela padrão), lg = 1280x720
 */
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import {
  GAMES, GAME_LIST, createRng, isEngineError, resolveConfig,
  type AnyEngine, type GameId, type RoomState, type SeatPlayer, type StepResult,
} from '@cards/shared';
import { ENGINES } from '@cards/games';
import { GAME_VIEWS } from '../games/registry';

const SIZES: Record<string, [number, number]> = { sm: [340, 390], md: [420, 570], lg: [1280, 720] };
const NAMES = ['Você', 'Ana', 'Beto', 'Carla', 'Duda', 'Edu', 'Fê', 'Gabi', 'Hugo'];

interface Sim {
  state: any;
  pending: boolean;
  log: string[];
}

function makeSim(gameId: GameId, players: number | undefined, seed: number, steps: number, stopAtTurn: boolean) {
  const engine = ENGINES[gameId] as AnyEngine;
  const meta = GAMES[gameId];
  const config = resolveConfig(gameId, players ? { players, seats: players } : {});
  const n = meta.economy === 'session' ? Math.min(players ?? 4, config.seats) : config.players;
  const rng = createRng(seed);
  const ctx = () => ({ rng, now: Date.now() });
  const seatPlayers: SeatPlayer[] = Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: NAMES[i], isBot: i !== 0 }));
  const sim: Sim = { state: null, pending: false, log: [] };
  const take = (r: StepResult<any>) => {
    sim.state = r.state;
    if (r.advanceInMs !== undefined) sim.pending = true;
    for (const e of r.events ?? []) if (e.text) sim.log.push(e.text);
  };
  if (engine.economy === 'session') {
    sim.state = engine.create(config, ctx());
    seatPlayers.forEach((p, i) => {
      const r = engine.sitDown(sim.state, i, p, config.maxBuyIn, ctx());
      if (!isEngineError(r)) take(r);
    });
  } else {
    take(engine.create(config, seatPlayers, ctx()));
  }
  /** roda bots/advance até ser a vez do assento 0 (ou acabar os passos) */
  const runBots = (max: number) => {
    for (let i = 0; i < max; i++) {
      if (engine.economy === 'match' && engine.getResult(sim.state)) return;
      const turn = engine.getTurn(sim.state);
      if (turn.seats.length > 0) {
        if (stopAtTurn && turn.seats.includes(0)) return;
        const seat = turn.seats.find((s) => s !== 0) ?? turn.seats[0];
        const r = engine.applyAction(sim.state, seat, engine.botAction(sim.state, seat, ctx()), ctx());
        if (isEngineError(r)) { sim.log.push(`ERRO bot: ${r.error}`); return; }
        take(r);
      } else if (sim.pending) {
        sim.pending = false;
        take(engine.advance(sim.state, ctx()));
      } else return;
    }
  };
  runBots(steps);
  const room: RoomState = {
    id: 'dev', code: 'DEV123', name: `Galeria ${meta.name}`, gameId, isPrivate: true, hostUserId: 'u0',
    status: 'playing', config,
    seats: seatPlayers.map((p, i) => ({ seat: i, userId: p.userId, name: p.name, isBot: p.isBot, connected: true })),
    spectators: [], lastResult: null,
  };
  return { engine, sim, room, ctx, take, runBots, config };
}

function GameFrame({ gameId, w, h, players, seed, steps, stopAtTurn }: {
  gameId: GameId; w: number; h: number; players?: number; seed: number; steps: number; stopAtTurn: boolean;
}) {
  const ref = useRef<ReturnType<typeof makeSim> | null>(null);
  if (!ref.current) ref.current = makeSim(gameId, players, seed, steps, stopAtTurn);
  const [, force] = useState(0);
  const { engine, sim, room, ctx, take, runBots, config } = ref.current;
  const View = GAME_VIEWS[gameId];
  const turn = engine.getTurn(sim.state);
  const sendAction = useCallback(async (action: unknown) => {
    const r = engine.applyAction(sim.state, 0, action, ctx());
    if (isEngineError(r)) return { ok: false, error: r.error };
    take(r);
    force((x) => x + 1);
    // bots respondem com um pequeno atraso para dar para ver
    setTimeout(() => { runBots(400); force((x) => x + 1); }, 400);
    return { ok: true };
  }, [engine, sim, ctx, take, runBots]);
  const view = engine.getView(sim.state, 0);
  return (
    <div className="gallery-item">
      <div className="gallery-label">
        {GAMES[gameId].name} · {w}x{h} · vez: [{turn.seats.join(',')}]
        <button type="button" onClick={() => { runBots(1); force((x) => x + 1); }}>passo</button>
        <button type="button" onClick={() => { runBots(400); force((x) => x + 1); }}>até minha vez</button>
      </div>
      <div className="room-game gallery-frame" style={{ width: w, height: h }} data-config={JSON.stringify(config)}>
        <Suspense fallback={<div>carregando…</div>}>
          <View view={view} mySeat={0} room={room}
            turn={{ seats: turn.seats, deadline: turn.seats.length ? Date.now() + turn.timeoutMs : null }}
            sendAction={sendAction} />
        </Suspense>
      </div>
      {sim.log.length > 0 && <div className="gallery-log">{sim.log.slice(-3).join(' · ')}</div>}
    </div>
  );
}

export function Gallery() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const which = q.get('gallery') || 'all';
  // clean=1: sem etiquetas de dev e ocupando a janela inteira (para screenshots do README)
  const clean = q.has('clean');
  const [sw, sh] = clean ? [innerWidth, innerHeight] : SIZES[q.get('size') ?? 'sm'] ?? SIZES.sm;
  const w = Number(q.get('w')) || sw;
  const h = Number(q.get('h')) || sh;
  const players = Number(q.get('players')) || undefined;
  const seed = Number(q.get('seed')) || 7;
  const steps = Number(q.get('steps')) || 400;
  const stopAtTurn = q.get('stop') !== 'none';
  const ids = which === 'all' ? GAME_LIST.map((g) => g.id) : (which.split(',') as GameId[]);
  return (
    <div className={`gallery${q.has('hide') ? ' hide-my-cards' : ''}`}>
      <style>{`
        body { overflow: auto; }
        .gallery { display: flex; flex-wrap: wrap; gap: 16px; padding: 12px; align-items: flex-start; }
        .gallery-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; display: flex; gap: 6px; align-items: center; }
        .gallery-label button { font-size: 10px; padding: 1px 6px; }
        .gallery-frame { outline: 1px solid #555; background: var(--bg); }
        .gallery-log { font-size: 10px; color: var(--muted); max-width: 340px; margin-top: 4px; }
        ${clean ? `body { overflow: hidden; } .gallery { padding: 0; gap: 0; } .gallery-label, .gallery-log { display: none; } .gallery-frame { outline: none; }` : ''}
      `}</style>
      {ids.map((id) => (
        <GameFrame key={`${id}-${seed}`} gameId={id} w={w} h={h} players={players} seed={seed} steps={steps} stopAtTurn={stopAtTurn} />
      ))}
    </div>
  );
}
