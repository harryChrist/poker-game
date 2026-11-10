import type { GameId } from './games';

/**
 * CONTRATO DOS MOTORES DE JOGO
 *
 * Regras gerais (todos os motores):
 * - Funções puras: NUNCA mutar o `state` recebido; sempre devolver um novo (structuredClone no início é aceitável).
 * - O state precisa ser serializável em JSON (sem classes, Map, Set, funções).
 * - Toda ação vem do cliente e não é confiável: validar formato e regra, devolver { error } em português.
 * - Aleatoriedade SOMENTE via ctx.rng (nunca Math.random) para os testes serem determinísticos.
 * - Assentos são índices 0..N-1. Em jogos de dupla com 4 jogadores: time 0 = assentos 0 e 2, time 1 = assentos 1 e 3.
 * - getView NUNCA pode vazar cartas escondidas de outros jogadores (use HiddenCard).
 * - O servidor repassa QUALQUER ação de um jogador sentado: o motor é quem valida se é a vez dele.
 * - advance: o servidor mantém no máximo UM timer. Um StepResult com advanceInMs substitui o timer pendente;
 *   um StepResult sem advanceInMs não mexe no timer. advance() deve ser seguro se chamado sem nada a avançar
 *   (devolve o estado igual, sem advanceInMs).
 * - O motor NÃO mexe na carteira: em jogos session só altera stacks; em jogos match o servidor cobra `stake` e paga o pote
 *   aos `winners` de getResult.
 */

export interface SeatPlayer {
  userId: string;
  name: string;
  isBot: boolean;
}

export interface EngineCtx {
  rng: () => number;
  /** timestamp ms */
  now: number;
}

/** Evento para log/animação no cliente (ex.: "Ana pediu TRUCO!") */
export interface GameEvent {
  type: string;
  seat?: number;
  text?: string;
  data?: unknown;
}

export interface StepResult<S> {
  state: S;
  events?: GameEvent[];
  /**
   * Pede ao servidor para chamar engine.advance(state) depois de N ms.
   * Usar para pausas: mostrar resultado da mão, recolher vaza, dar a próxima mão, revelar cartas da banca etc.
   * Enquanto houver advance pendente, getTurn deve retornar seats: [] (ninguém age).
   */
  advanceInMs?: number;
}

export interface EngineError {
  error: string;
}

export interface TurnInfo {
  /** Assentos que precisam agir agora (pode ser mais de um, ex.: apostas simultâneas do blackjack). Vazio = ninguém. */
  seats: number[];
  /** Tempo limite para agir; ao estourar, o servidor aplica timeoutAction */
  timeoutMs: number;
}

export interface MatchResult {
  /** Assentos vencedores — o pote é dividido igualmente entre eles */
  winners: number[];
  /** Texto curto para exibir, ex.: "Dupla A venceu por 12 x 7" */
  summary: string;
}

interface EngineBase<S, A> {
  id: GameId;

  /** Aplica ação de um jogador. Ações inválidas => { error }. */
  applyAction(state: S, seat: number, action: A, ctx: EngineCtx): StepResult<S> | EngineError;

  /** Chamado pelo servidor quando o advanceInMs pedido expira. */
  advance(state: S, ctx: EngineCtx): StepResult<S>;

  /** Visão do estado para um assento (null = espectador). Deve ser JSON e esconder cartas alheias. */
  getView(state: S, seat: number | null): unknown;

  getTurn(state: S): TurnInfo;

  /** Ação automática quando o jogador estoura o tempo ou está desconectado (ex.: fold/check, jogar a menor carta). Deve ser SEMPRE válida. */
  timeoutAction(state: S, seat: number): A;

  /** Jogada do bot. Deve ser SEMPRE válida. Bot razoável, não precisa ser perfeito. */
  botAction(state: S, seat: number, ctx: EngineCtx): A;
}

/** Poker / Blackjack: jogadores entram e saem da mesa com fichas */
export interface SessionEngine<S = any, A = any> extends EngineBase<S, A> {
  economy: 'session';
  /** Cria a mesa vazia. config já vem resolvida (resolveConfig). */
  create(config: Record<string, number>, ctx: EngineCtx): S;
  /** Senta um jogador com `stack` fichas. Se der para começar uma mão, devolver advanceInMs. */
  sitDown(state: S, seat: number, player: SeatPlayer, stack: number, ctx: EngineCtx): StepResult<S> | EngineError;
  /** Remove o jogador (no meio da mão: fold/abandona aposta). cashOut = fichas que voltam para a carteira. */
  standUp(state: S, seat: number, ctx: EngineCtx): StepResult<S> & { cashOut: number };
  /** Adiciona fichas (rebuy). Pode recusar durante uma mão em andamento. */
  addChips(state: S, seat: number, amount: number, ctx: EngineCtx): StepResult<S> | EngineError;
  /** Fichas atuais de cada assento ocupado (fora do pote). Usado para persistir/garantir saldo. */
  getStacks(state: S): Record<number, number>;
}

/** Truco, Bisca, Sueca, Copas, Fodinha, Cacheta, Pife: partida com assentos fixos e aposta única */
export interface MatchEngine<S = any, A = any> extends EngineBase<S, A> {
  economy: 'match';
  /** Cria e já inicia a partida. players[i] = assento i (todos preenchidos, bots incluídos). */
  create(config: Record<string, number>, players: SeatPlayer[], ctx: EngineCtx): StepResult<S>;
  /** Resultado final quando a partida acabou; null enquanto em andamento. */
  getResult(state: S): MatchResult | null;
  /** Um jogador humano saiu: passa a ser bot (o servidor chamará botAction para esse assento). */
  replaceWithBot(state: S, seat: number, botName: string): S;
}

export type AnyEngine = SessionEngine | MatchEngine;

export function isEngineError(r: unknown): r is EngineError {
  return typeof r === 'object' && r !== null && typeof (r as EngineError).error === 'string';
}
