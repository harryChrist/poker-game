/**
 * Utilitários de teste compartilhados pelos motores.
 * Simulam o que o servidor faz: chama botAction/timeoutAction para quem está na vez
 * e advance() quando ninguém está na vez e há advance pendente.
 */
import {
  createRng, isEngineError,
  type MatchEngine, type SessionEngine, type SeatPlayer, type EngineCtx, type StepResult, type MatchResult,
} from '@cards/shared';

export function bots(n: number): SeatPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ userId: `bot${i}`, name: `Bot ${i}`, isBot: true }));
}

function ctxFrom(rng: () => number, now: { t: number }): EngineCtx {
  return { rng, now: now.t };
}

function assertJson(v: unknown, where: string) {
  const s = JSON.stringify(v);
  const back = JSON.parse(s);
  if (JSON.stringify(back) !== s) throw new Error(`${where}: não é JSON estável`);
}

export interface SimOptions {
  seed?: number;
  maxSteps?: number;
  /** Probabilidade de usar timeoutAction em vez de botAction (testa as duas) */
  timeoutRate?: number;
  /** Checa getView de todos os assentos a cada passo (mais lento) */
  checkViews?: boolean;
  /** Callback a cada estado novo, para asserts do próprio jogo (ex.: conservação de fichas) */
  onState?: (state: any) => void;
}

/** Joga uma partida inteira só com bots. Lança erro se travar ou se alguma ação gerada for inválida. */
export function simulateMatch<S>(
  engine: MatchEngine<S>,
  config: Record<string, number>,
  players: number,
  opts: SimOptions = {},
): { result: MatchResult; state: S; steps: number } {
  const rng = createRng(opts.seed ?? 1);
  const now = { t: 1_000_000 };
  const maxSteps = opts.maxSteps ?? 50_000;
  let r: StepResult<S> = engine.create(config, bots(players), ctxFrom(rng, now));
  let state = r.state;
  let pending = r.advanceInMs !== undefined;
  for (let step = 0; step < maxSteps; step++) {
    assertJson(state, 'state');
    opts.onState?.(state);
    if (opts.checkViews) {
      for (let s = 0; s < players; s++) assertJson(engine.getView(state, s), `view seat ${s}`);
      assertJson(engine.getView(state, null), 'view spectator');
    }
    const result = engine.getResult(state);
    if (result) return { result, state, steps: step };
    const turn = engine.getTurn(state);
    now.t += 500;
    if (turn.seats.length > 0) {
      const seat = turn.seats[0];
      const useTimeout = rng() < (opts.timeoutRate ?? 0.15);
      const action = useTimeout ? engine.timeoutAction(state, seat) : engine.botAction(state, seat, ctxFrom(rng, now));
      const out = engine.applyAction(state, seat, action, ctxFrom(rng, now));
      if (isEngineError(out)) {
        throw new Error(`Ação ${useTimeout ? 'timeout' : 'bot'} inválida no assento ${seat}: ${out.error} :: ${JSON.stringify(action)}`);
      }
      state = out.state;
      if (out.advanceInMs !== undefined) pending = true;
    } else if (pending) {
      const out = engine.advance(state, ctxFrom(rng, now));
      state = out.state;
      pending = out.advanceInMs !== undefined;
    } else {
      throw new Error('Travou: ninguém na vez, sem advance pendente e sem resultado');
    }
  }
  throw new Error(`Partida não terminou em ${maxSteps} passos`);
}

/**
 * Senta N bots com `stack` fichas e roda `steps` passos de jogo de sessão.
 * Ao final levanta todos e devolve o total de cashOut (para checar conservação de fichas).
 */
export function simulateSession<S>(
  engine: SessionEngine<S>,
  config: Record<string, number>,
  stacks: number[],
  steps: number,
  opts: SimOptions = {},
): { state: S; cashOut: number[] } {
  const rng = createRng(opts.seed ?? 1);
  const now = { t: 1_000_000 };
  let state = engine.create(config, ctxFrom(rng, now));
  let pending = false;
  const players = bots(stacks.length);
  stacks.forEach((st, seat) => {
    const out = engine.sitDown(state, seat, players[seat], st, ctxFrom(rng, now));
    if (isEngineError(out)) throw new Error(`sitDown falhou: ${out.error}`);
    state = out.state;
    if (out.advanceInMs !== undefined) pending = true;
  });
  for (let step = 0; step < steps; step++) {
    assertJson(state, 'state');
    opts.onState?.(state);
    if (opts.checkViews) {
      for (let s = 0; s < stacks.length; s++) assertJson(engine.getView(state, s), `view seat ${s}`);
    }
    const turn = engine.getTurn(state);
    now.t += 500;
    if (turn.seats.length > 0) {
      const seat = turn.seats[0];
      const useTimeout = rng() < (opts.timeoutRate ?? 0.15);
      const action = useTimeout ? engine.timeoutAction(state, seat) : engine.botAction(state, seat, ctxFrom(rng, now));
      const out = engine.applyAction(state, seat, action, ctxFrom(rng, now));
      if (isEngineError(out)) {
        throw new Error(`Ação ${useTimeout ? 'timeout' : 'bot'} inválida no assento ${seat}: ${out.error} :: ${JSON.stringify(action)}`);
      }
      state = out.state;
      if (out.advanceInMs !== undefined) pending = true;
    } else if (pending) {
      const out = engine.advance(state, ctxFrom(rng, now));
      state = out.state;
      pending = out.advanceInMs !== undefined;
    } else {
      break; // mesa parada (ex.: só sobrou 1 jogador com fichas)
    }
  }
  const cashOut: number[] = [];
  for (let seat = 0; seat < stacks.length; seat++) {
    const out = engine.standUp(state, seat, ctxFrom(rng, now));
    state = out.state;
    cashOut.push(out.cashOut);
  }
  return { state, cashOut };
}
