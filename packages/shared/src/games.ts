export type GameId = 'poker' | 'blackjack' | 'truco' | 'bisca' | 'sueca' | 'copas' | 'fodinha' | 'cacheta' | 'pife';

/**
 * session = jogador senta com fichas (buy-in) e pode sair a qualquer momento levando o que sobrou (poker, blackjack).
 * match   = todos apostam `stake` no início da partida, quem vence leva o pote (truco, bisca, sueca...).
 */
export type Economy = 'session' | 'match';

export interface ConfigField {
  key: string;
  label: string;
  type: 'number' | 'select';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  help?: string;
}

export interface GameMeta {
  id: GameId;
  name: string;
  description: string;
  economy: Economy;
  /** Número de assentos possíveis. Para jogos match, o valor de config.players precisa estar aqui. */
  playerCounts: number[];
  /** Jogo em duplas quando há 4 jogadores (assentos 0 e 2 x 1 e 3) */
  teamsWhen4?: boolean;
  configFields: ConfigField[];
}

const TURN_OPTIONS = [0, 15, 20, 25, 30, 45, 60, 90];
/** Tempo por jogada + o que acontece quando ele acaba. Todos os jogos têm esses dois campos. */
const turnField = (def: number): ConfigField[] => [
  {
    key: 'turnSeconds', label: 'Tempo por jogada', type: 'select', default: def,
    options: TURN_OPTIONS.map((n) => ({ value: n, label: n === 0 ? 'Sem limite (cada um no seu tempo)' : `${n} segundos` })),
  },
  {
    key: 'onTimeout', label: 'Quando o tempo acabar', type: 'select', default: 0,
    options: [{ value: 0, label: 'Joga automaticamente' }, { value: 1, label: 'Sai da mesa' }],
    help: 'Em partidas com aposta, quem sai perde a aposta e um bot assume o lugar. Não vale para "Sem limite".',
  },
];
const stakeField: ConfigField = {
  key: 'stake', label: 'Aposta por jogador', type: 'number', default: 100, min: 10, max: 1_000_000, step: 10,
  help: 'Cada jogador paga isso no início; o vencedor (ou a dupla vencedora) leva o pote.',
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const playersField = (counts: number[], def: number, teams = false): ConfigField => ({
  key: 'players', label: 'Jogadores', type: 'select', default: def,
  options: counts.map((n) => ({ value: n, label: teams && n === 4 ? '4 (duplas)' : String(n) })),
});

export const GAMES: Record<GameId, GameMeta> = {
  poker: {
    id: 'poker', name: 'Poker Texas Hold\'em', description: 'No-Limit Hold\'em. Entre com fichas e saia quando quiser.',
    economy: 'session', playerCounts: range(2, 9),
    configFields: [
      { key: 'seats', label: 'Lugares na mesa', type: 'select', default: 6, options: range(2, 9).map((n) => ({ value: n, label: String(n) })) },
      { key: 'smallBlind', label: 'Small blind', type: 'number', default: 10, min: 1, step: 1 },
      { key: 'bigBlind', label: 'Big blind', type: 'number', default: 20, min: 2, step: 1 },
      { key: 'minBuyIn', label: 'Entrada mínima', type: 'number', default: 400, min: 10, step: 10 },
      { key: 'maxBuyIn', label: 'Entrada máxima', type: 'number', default: 4000, min: 10, step: 10 },
      ...turnField(30),
    ],
  },
  blackjack: {
    id: 'blackjack', name: 'Blackjack (21)', description: 'Contra a banca. Blackjack paga 3:2, banca para no 17.',
    economy: 'session', playerCounts: range(1, 5),
    configFields: [
      { key: 'seats', label: 'Lugares na mesa', type: 'select', default: 5, options: range(1, 5).map((n) => ({ value: n, label: String(n) })) },
      { key: 'minBet', label: 'Aposta mínima', type: 'number', default: 10, min: 1, step: 1 },
      { key: 'maxBet', label: 'Aposta máxima', type: 'number', default: 1000, min: 1, step: 10 },
      { key: 'minBuyIn', label: 'Entrada mínima', type: 'number', default: 100, min: 1, step: 10 },
      { key: 'maxBuyIn', label: 'Entrada máxima', type: 'number', default: 10000, min: 1, step: 10 },
      { key: 'decks', label: 'Baralhos no sapato', type: 'select', default: 6, options: [1, 2, 4, 6, 8].map((n) => ({ value: n, label: String(n) })) },
      ...turnField(20),
    ],
  },
  truco: {
    id: 'truco', name: 'Truco Paulista', description: 'Com vira e manilha. Partida até 12 pontos, 1x1 ou duplas.',
    economy: 'match', playerCounts: [2, 4], teamsWhen4: true,
    configFields: [playersField([2, 4], 4, true), stakeField, ...turnField(25)],
  },
  bisca: {
    id: 'bisca', name: 'Bisca', description: 'Bisca de 3 cartas com trunfo. Faça mais de 60 pontos.',
    economy: 'match', playerCounts: [2, 4], teamsWhen4: true,
    configFields: [
      playersField([2, 4], 2, true), stakeField,
      { key: 'targetWins', label: 'Vitórias para fechar', type: 'select', default: 1, options: [1, 2, 3].map((n) => ({ value: n, label: n === 1 ? '1 jogo' : `melhor de ${n * 2 - 1}` })) },
      ...turnField(20),
    ],
  },
  sueca: {
    id: 'sueca', name: 'Sueca', description: 'Duplas, 40 cartas, trunfo. Somar mais de 60 pontos por mão.',
    economy: 'match', playerCounts: [4], teamsWhen4: true,
    configFields: [
      playersField([4], 4, true), stakeField,
      { key: 'targetGames', label: 'Jogos para vencer', type: 'select', default: 4, options: [1, 2, 4, 6].map((n) => ({ value: n, label: String(n) })) },
      ...turnField(20),
    ],
  },
  copas: {
    id: 'copas', name: 'Copas', description: 'Fuja das copas e da dama de espadas. Menor pontuação vence.',
    economy: 'match', playerCounts: [4],
    configFields: [
      playersField([4], 4), stakeField,
      { key: 'endScore', label: 'Termina em', type: 'select', default: 100, options: [50, 75, 100].map((n) => ({ value: n, label: `${n} pontos` })) },
      ...turnField(20),
    ],
  },
  fodinha: {
    id: 'fodinha', name: 'Fodinha', description: 'Aposte quantas vazas vai fazer. Errou, perde vida.',
    economy: 'match', playerCounts: range(2, 8),
    configFields: [
      playersField(range(2, 8), 4), stakeField,
      { key: 'lives', label: 'Vidas', type: 'select', default: 5, options: [3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) })) },
      ...turnField(20),
    ],
  },
  cacheta: {
    id: 'cacheta', name: 'Cacheta', description: 'Forme trincas e sequências com coringa da vira e bata primeiro.',
    economy: 'match', playerCounts: range(2, 6),
    configFields: [
      playersField(range(2, 6), 4), stakeField,
      { key: 'lives', label: 'Pontos (vidas)', type: 'select', default: 5, options: [3, 5, 7, 10].map((n) => ({ value: n, label: String(n) })) },
      ...turnField(25),
    ],
  },
  pife: {
    id: 'pife', name: 'Pife', description: 'Forme 3 jogos (trincas ou sequências) com 9 cartas e bata.',
    economy: 'match', playerCounts: range(2, 6),
    configFields: [
      playersField(range(2, 6), 3), stakeField,
      { key: 'targetWins', label: 'Vitórias para fechar', type: 'select', default: 1, options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })) },
      ...turnField(25),
    ],
  },
};

export const GAME_LIST: GameMeta[] = Object.values(GAMES);

/** Monta a config final a partir dos defaults + valores enviados (sem validar regras específicas) */
export function resolveConfig(gameId: GameId, input: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of GAMES[gameId].configFields) {
    const v = input?.[f.key];
    let n = typeof v === 'number' && Number.isFinite(v) ? v : f.default;
    if (f.type === 'select' && f.options && !f.options.some((o) => o.value === n)) n = f.default;
    if (f.min !== undefined) n = Math.max(f.min, n);
    if (f.max !== undefined) n = Math.min(f.max, n);
    out[f.key] = Math.floor(n);
  }
  return out;
}

/** Quantos assentos a sala terá */
export function seatCount(gameId: GameId, config: Record<string, number>): number {
  return GAMES[gameId].economy === 'session' ? config.seats : config.players;
}
