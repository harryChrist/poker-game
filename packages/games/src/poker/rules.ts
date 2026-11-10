import { cardLabel, deck52, shuffle, type Card, type EngineError, type GameEvent, type SeatPlayer } from '@cards/shared';
import { evaluate, type HandEval } from './evaluator';
import type {
  Action, HandPlayer, HandResult, Legal, PotResult, State, Street,
} from './types';

export const TIMING = { start: 1500, reveal: 700, runout: 1000, result: 4000 };

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export function createState(config: Record<string, number>): State {
  const seats = Math.max(2, Math.min(9, Math.floor(config.seats ?? 6)));
  const bb = Math.max(2, Math.floor(config.bigBlind ?? 20));
  const sb = Math.max(1, Math.min(bb, Math.floor(config.smallBlind ?? 10)));
  const turnSeconds = Math.max(5, Math.floor(config.turnSeconds ?? 30));
  return {
    cfg: { seats, sb, bb, turnMs: turnSeconds * 1000 },
    seats: Array.from({ length: seats }, () => null),
    phase: 'idle', button: -1, handNo: 0, hand: [], deck: [], board: [], street: 'preflop',
    toAct: -1, currentBet: 0, lastRaise: bb, sbSeat: -1, bbSeat: -1, runout: false, result: null,
  };
}

/* ---------------- helpers ---------------- */

export function potTotal(s: State): number {
  let t = 0;
  for (const p of s.hand) t += p.total;
  return t;
}

export function entryFor(s: State, seat: number): HandPlayer | undefined {
  const e = s.hand.find((p) => p.seat === seat);
  return e && !e.left ? e : undefined;
}

function eligibleSeats(s: State): number[] {
  const out: number[] = [];
  s.seats.forEach((st, i) => { if (st && st.stack + st.pending > 0) out.push(i); });
  return out;
}

export function canStartHand(s: State): boolean {
  return eligibleSeats(s).length >= 2;
}

function nextAfter(list: number[], from: number): number {
  return list.find((x) => x > from) ?? list[0];
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function cards(list: readonly Card[]): string {
  return list.map(cardLabel).join(' ');
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function commit(s: State, p: HandPlayer, amount: number): void {
  const st = s.seats[p.seat]!;
  st.stack -= amount;
  p.bet += amount;
  p.total += amount;
  if (st.stack === 0) p.allIn = true;
}

function liveEntries(s: State): HandPlayer[] {
  return s.hand.filter((p) => !p.folded);
}

/** O jogador precisa agir (ou responder a uma aposta) nesta rodada? */
function needsAct(s: State, p: HandPlayer): boolean {
  if (p.folded || p.allIn) return false;
  if (p.bet < s.currentBet) return true;
  if (p.actedAt !== null) return false;
  // opção de check/aposta só faz sentido se existir alguém que ainda possa responder
  return s.hand.some((q) => q !== p && !q.folded && !q.allIn);
}

function nextActor(s: State, from: number, inclusive = false): number {
  const order = s.hand.slice().sort((a, b) => a.seat - b.seat);
  const n = order.length;
  let start = order.findIndex((p) => (inclusive ? p.seat >= from : p.seat > from));
  if (start < 0) start = 0;
  for (let k = 0; k < n; k++) {
    const p = order[(start + k) % n];
    if (needsAct(s, p)) return p.seat;
  }
  return -1;
}

/** Pode aumentar? (a ação foi reaberta para ele por um aumento completo desde a última vez que agiu) */
function canRaise(s: State, p: HandPlayer): boolean {
  return p.actedAt === null || s.currentBet - p.actedAt >= s.lastRaise;
}

export interface Contribution { seat: number; amount: number; live: boolean }

/** Divide as contribuições em potes (principal + laterais). Cada pote lista quem pode ganhá-lo. */
export function computePots(contribs: Contribution[]): { amount: number; eligible: number[] }[] {
  const rem = contribs.map((c) => c.amount);
  const pots: { amount: number; eligible: number[] }[] = [];
  for (;;) {
    const liveIdx: number[] = [];
    contribs.forEach((c, i) => { if (c.live && rem[i] > 0) liveIdx.push(i); });
    if (!liveIdx.length) break;
    const layer = Math.min(...liveIdx.map((i) => rem[i]));
    let amount = 0;
    for (let i = 0; i < contribs.length; i++) {
      const take = Math.min(rem[i], layer);
      amount += take;
      rem[i] -= take;
    }
    pots.push({ amount, eligible: liveIdx.map((i) => contribs[i].seat) });
  }
  const left = rem.reduce((a, b) => a + b, 0);
  if (left > 0 && pots.length) pots[pots.length - 1].amount += left;
  return pots;
}

/* ---------------- início de mão ---------------- */

export function startHand(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  for (const st of s.seats) {
    if (st && st.pending > 0) { st.stack += st.pending; st.pending = 0; }
  }
  const elig = eligibleSeats(s);
  if (elig.length < 2) {
    s.phase = 'idle'; s.hand = []; s.board = []; s.result = null; s.toAct = -1; s.runout = false;
    return undefined;
  }
  if (s.button < 0) s.button = elig[Math.floor(rng() * elig.length)];
  s.button = nextAfter(elig, s.button);
  s.handNo++;
  s.result = null;
  s.board = [];
  s.runout = false;
  s.street = 'preflop';
  s.deck = shuffle(deck52(), rng);
  s.hand = elig.map((seat) => {
    const st = s.seats[seat]!;
    return {
      seat, userId: st.player.userId, name: st.player.name, isBot: st.player.isBot, cards: [], bet: 0, total: 0,
      folded: false, allIn: false, actedAt: null, left: false, last: '',
    };
  });
  for (let r = 0; r < 2; r++) for (const p of s.hand) p.cards.push(s.deck.pop()!);

  if (elig.length === 2) {
    s.sbSeat = s.button;
    s.bbSeat = elig.find((x) => x !== s.button)!;
  } else {
    s.sbSeat = nextAfter(elig, s.button);
    s.bbSeat = nextAfter(elig, s.sbSeat);
  }
  ev.push({ type: 'hand_start', text: `Mão #${s.handNo}`, data: { button: s.button } });
  const dealerName = s.hand.find((x) => x.seat === s.button)?.name ?? `Assento ${s.button + 1}`;
  ev.push({ type: 'dealer', seat: s.button, text: `${dealerName} é o dealer (botão)` });
  const post = (seat: number, amount: number, label: string) => {
    const p = s.hand.find((x) => x.seat === seat)!;
    const pay = Math.min(s.seats[seat]!.stack, amount);
    commit(s, p, pay);
    p.last = p.allIn ? `All-in ${fmt(pay)}` : `Blind ${fmt(pay)}`;
    ev.push({ type: 'blind', seat, text: `${p.name} postou ${label} ${fmt(pay)}${p.allIn ? ' (all-in)' : ''}` });
  };
  post(s.sbSeat, s.cfg.sb, 'small blind');
  post(s.bbSeat, s.cfg.bb, 'big blind');
  s.currentBet = Math.max(...s.hand.map((p) => p.bet));
  s.lastRaise = s.cfg.bb;
  s.phase = 'betting';
  return continueHand(s, s.bbSeat, ev);
}

/* ---------------- fluxo de apostas ---------------- */

/** Depois de uma ação: define o próximo a agir ou encerra a rodada/mão. Devolve advanceInMs se houver pausa. */
function continueHand(s: State, from: number, ev: GameEvent[], inclusive = false): number | undefined {
  const live = liveEntries(s);
  if (live.length <= 1) {
    awardUncontested(s, ev);
    return TIMING.result;
  }
  const next = nextActor(s, from, inclusive);
  if (next !== -1) {
    s.toAct = next;
    s.phase = 'betting';
    return undefined;
  }
  s.toAct = -1;
  if (s.street === 'river') {
    showdown(s, ev);
    return TIMING.result;
  }
  s.runout = live.filter((p) => !p.allIn).length < 2;
  if (s.runout) {
    // all-in: as cartas dos jogadores ainda na mão ficam à mostra (a view também as revela)
    for (const p of live) {
      ev.push({ type: 'show', seat: p.seat, text: `${p.name} mostrou ${cards(p.cards)} (all-in)`, data: { cards: p.cards } });
    }
  }
  s.phase = 'reveal';
  return s.runout ? TIMING.runout : TIMING.reveal;
}

function dealNextStreet(s: State, ev: GameEvent[]): void {
  const idx = STREETS.indexOf(s.street) + 1;
  s.street = STREETS[idx];
  s.deck.pop(); // queima
  const n = s.street === 'flop' ? 3 : 1;
  for (let i = 0; i < n; i++) s.board.push(s.deck.pop()!);
  for (const p of s.hand) {
    p.bet = 0;
    p.actedAt = null;
    if (!p.folded && !p.allIn) p.last = '';
  }
  s.currentBet = 0;
  s.lastRaise = s.cfg.bb;
  const fresh = s.board.slice(-n);
  const label = s.street === 'flop' ? 'Flop' : s.street === 'turn' ? 'Turn' : 'River';
  const text = s.street === 'flop' ? `Flop: ${cards(fresh)}` : `${label}: ${cards(fresh)} — mesa: ${cards(s.board)}`;
  ev.push({ type: 'street', text, data: { street: s.street, cards: fresh, board: s.board.map((c) => c.id) } });
}

export function advanceReveal(s: State, ev: GameEvent[]): number | undefined {
  if (s.street === 'river') {
    showdown(s, ev);
    return TIMING.result;
  }
  dealNextStreet(s, ev);
  if (s.runout) return TIMING.runout;
  const first = nextActor(s, s.button);
  if (first === -1) {
    // não deveria acontecer (≥2 jogadores podem agir), mas evita travar
    s.runout = true;
    return TIMING.runout;
  }
  s.toAct = first;
  s.phase = 'betting';
  return undefined;
}

/* ---------------- ações ---------------- */

export function legalFor(s: State, seat: number): Legal | null {
  if (s.phase !== 'betting' || s.toAct !== seat) return null;
  const p = entryFor(s, seat);
  const st = s.seats[seat];
  if (!p || !st) return null;
  const toCall = Math.max(0, s.currentBet - p.bet);
  const pot = potTotal(s);
  const maxTo = p.bet + st.stack;
  const raiseOk = maxTo > s.currentBet && canRaise(s, p);
  let raise: Legal['raise'] = null;
  if (raiseOk) {
    const min = Math.min(s.currentBet + s.lastRaise, maxTo);
    const clamp = (v: number) => Math.max(min, Math.min(maxTo, Math.round(v)));
    raise = {
      min, max: maxTo,
      half: clamp(s.currentBet + (pot + toCall) / 2),
      pot: clamp(s.currentBet + (pot + toCall)),
    };
  }
  return {
    check: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, st.stack) : null,
    toCall,
    raise,
    allin: st.stack > 0 && (maxTo <= s.currentBet || canRaise(s, p)) ? maxTo : null,
    pot,
  };
}

export function applyBetAction(s: State, seat: number, a: Action, ev: GameEvent[]): { advanceInMs?: number } | EngineError {
  if (!a || typeof a !== 'object' || typeof (a as { type?: unknown }).type !== 'string') return { error: 'Ação inválida.' };
  if (s.phase !== 'betting') return { error: 'Não há rodada de apostas em andamento.' };
  if (s.toAct !== seat) return { error: 'Não é a sua vez.' };
  const p = entryFor(s, seat);
  const st = s.seats[seat];
  if (!p || !st) return { error: 'Você não está nesta mão.' };
  const toCall = Math.max(0, s.currentBet - p.bet);
  const maxTo = p.bet + st.stack;

  const doRaise = (to: number) => {
    const before = s.currentBet;
    commit(s, p, to - p.bet);
    const size = to - s.currentBet;
    if (size >= s.lastRaise) s.lastRaise = size;
    s.currentBet = to;
    p.actedAt = to;
    p.last = p.allIn ? `All-in ${fmt(to)}` : before > 0 ? `Aumentou para ${fmt(to)}` : `Apostou ${fmt(to)}`;
    if (p.allIn) ev.push({ type: 'allin', seat, text: `${p.name} foi all-in com ${fmt(to)}${before > 0 ? ' (aumento)' : ''}` });
    else ev.push({ type: 'raise', seat, text: before > 0 ? `${p.name} aumentou para ${fmt(to)}` : `${p.name} apostou ${fmt(to)}` });
  };

  switch (a.type) {
    case 'fold':
      p.folded = true;
      p.last = 'Desistiu';
      ev.push({ type: 'fold', seat, text: `${p.name} desistiu` });
      break;
    case 'check':
      if (toCall > 0) return { error: `Você não pode dar check: há ${fmt(toCall)} para pagar.` };
      p.actedAt = s.currentBet;
      p.last = 'Check';
      ev.push({ type: 'check', seat, text: `${p.name} deu check` });
      break;
    case 'call': {
      if (toCall <= 0) return { error: 'Não há aposta para pagar. Use check.' };
      const pay = Math.min(st.stack, toCall);
      commit(s, p, pay);
      p.actedAt = s.currentBet;
      p.last = p.allIn ? `All-in ${fmt(p.bet)}` : `Pagou ${fmt(pay)}`;
      ev.push({ type: p.allIn ? 'allin' : 'call', seat, text: p.allIn ? `${p.name} pagou ${fmt(pay)} e foi all-in` : `${p.name} pagou ${fmt(pay)}` });
      break;
    }
    case 'raise': {
      const to = (a as { to: unknown }).to;
      if (typeof to !== 'number' || !Number.isInteger(to)) return { error: 'Valor de aposta inválido.' };
      if (maxTo <= s.currentBet) return { error: 'Você não tem fichas suficientes para aumentar. Pague ou dê all-in.' };
      if (!canRaise(s, p)) return { error: 'A ação não foi reaberta para você: só pode pagar ou desistir.' };
      if (to > maxTo) return { error: `Você só tem ${fmt(st.stack)} fichas (máximo ${fmt(maxTo)}).` };
      if (to <= s.currentBet) return { error: `O aumento precisa ser maior que ${fmt(s.currentBet)}.` };
      const min = Math.min(s.currentBet + s.lastRaise, maxTo);
      if (to < min) return { error: `${s.currentBet === 0 ? 'A aposta' : 'O aumento'} mínimo é ${fmt(min)}.` };
      doRaise(to);
      break;
    }
    case 'allin': {
      if (st.stack <= 0) return { error: 'Você não tem fichas.' };
      if (maxTo > s.currentBet) {
        if (!canRaise(s, p)) return { error: 'A ação não foi reaberta para você: só pode pagar ou desistir.' };
        doRaise(maxTo);
      } else {
        const pay = st.stack;
        commit(s, p, pay);
        p.actedAt = s.currentBet;
        p.last = `All-in ${fmt(p.bet)}`;
        ev.push({ type: 'allin', seat, text: `${p.name} foi all-in com ${fmt(pay)}` });
      }
      break;
    }
    default:
      return { error: 'Ação desconhecida.' };
  }
  return { advanceInMs: continueHand(s, seat, ev) };
}

/** Jogador sai no meio da mão: desiste (as fichas já apostadas ficam no pote). */
export function forceFold(s: State, seat: number, ev: GameEvent[]): number | undefined {
  const p = entryFor(s, seat);
  if (!p) return undefined;
  const wasLive = !p.folded;
  const wasTurn = s.toAct === seat && s.phase === 'betting';
  p.left = true;
  if (!wasLive || s.phase === 'result') return undefined;
  p.folded = true;
  p.last = 'Desistiu';
  ev.push({ type: 'fold', seat, text: `${p.name} desistiu (saiu da mesa)` });
  if (s.phase === 'betting') return wasTurn ? continueHand(s, seat, ev) : keepTurn(s, ev);
  // pausa entre ruas: só encerra se sobrou um único jogador
  if (liveEntries(s).length <= 1) {
    awardUncontested(s, ev);
    return TIMING.result;
  }
  return undefined;
}

/** Se quem saiu não era o da vez, mantém a vez de quem estava agindo (se ainda precisar agir). */
function keepTurn(s: State, ev: GameEvent[]): number | undefined {
  return continueHand(s, s.toAct, ev, true);
}

/* ---------------- fim de mão ---------------- */

function finishHand(s: State): void {
  for (const p of s.hand) { p.bet = 0; p.total = 0; }
  s.toAct = -1;
  s.currentBet = 0;
  s.phase = 'result';
}

function pay(s: State, seat: number, amount: number): void {
  const st = s.seats[seat];
  const e = s.hand.find((p) => p.seat === seat);
  if (st && e && !e.left) st.stack += amount;
}

function awardUncontested(s: State, ev: GameEvent[]): void {
  const total = potTotal(s);
  const winner = liveEntries(s)[0];
  if (winner) pay(s, winner.seat, total);
  const result: HandResult = {
    showdown: false, total,
    pots: winner ? [{ amount: total, eligible: [winner.seat], winners: [winner.seat], refund: false }] : [],
    winners: winner ? [{ seat: winner.seat, name: winner.name, amount: total }] : [],
    hands: [],
  };
  s.result = result;
  if (winner) ev.push({ type: 'win', seat: winner.seat, text: `${winner.name} ganhou ${fmt(total)} (todos desistiram)` });
  finishHand(s);
}

function showdown(s: State, ev: GameEvent[]): void {
  const total = potTotal(s);
  const live = liveEntries(s);
  const evals = new Map<number, HandEval>();
  for (const p of live) evals.set(p.seat, evaluate([...p.cards, ...s.board]));
  const pots = computePots(s.hand.map((p) => ({ seat: p.seat, amount: p.total, live: !p.folded })));
  const n = s.cfg.seats;
  const order = (seat: number) => (seat - s.button - 1 + n * 2) % n;
  const won = new Map<number, number>();
  const potResults: PotResult[] = [];
  for (const pot of pots) {
    let bestScore = -1;
    for (const seat of pot.eligible) bestScore = Math.max(bestScore, evals.get(seat)!.score);
    const winners = pot.eligible.filter((seat) => evals.get(seat)!.score === bestScore).sort((a, b) => order(a) - order(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const seat of winners) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      won.set(seat, (won.get(seat) ?? 0) + share + extra);
    }
    const refund = pot.eligible.length === 1;
    potResults.push({ amount: pot.amount, eligible: pot.eligible, winners, refund, handName: refund ? undefined : evals.get(winners[0])!.name });
  }
  for (const [seat, amount] of won) pay(s, seat, amount);
  const winnersList = [...won.entries()].map(([seat, amount]) => {
    const p = s.hand.find((x) => x.seat === seat)!;
    return { seat, name: p.name, amount, handName: evals.get(seat)?.name };
  });
  s.result = {
    showdown: true, total, pots: potResults, winners: winnersList,
    hands: live.map((p) => {
      const e = evals.get(p.seat)!;
      return { seat: p.seat, handName: e.name, category: e.category, best: e.best.map((c) => c.id) };
    }),
  };
  // cartas reveladas no showdown (em all-in já foram mostradas ao fechar as apostas)
  for (const p of live) {
    const e = evals.get(p.seat)!;
    ev.push(s.runout
      ? { type: 'show', seat: p.seat, text: `${p.name} fez ${e.name}`, data: { cards: p.cards, handName: e.name } }
      : { type: 'show', seat: p.seat, text: `${p.name} mostrou ${cards(p.cards)} — ${e.name}`, data: { cards: p.cards, handName: e.name } });
  }
  const nameOf = (seat: number) => s.hand.find((x) => x.seat === seat)?.name ?? `Assento ${seat + 1}`;
  let contested = 0;
  potResults.forEach((pr) => {
    if (pr.refund) {
      const seat = pr.winners[0];
      ev.push({ type: 'refund', seat, text: `${nameOf(seat)} recuperou ${fmt(pr.amount)} (aposta não igualada)` });
      return;
    }
    const label = potResults.length > 1 ? (contested++ === 0 ? ' (pote principal)' : ' (pote lateral)') : '';
    const names = pr.winners.map(nameOf);
    if (pr.winners.length === 1) {
      ev.push({ type: 'win', seat: pr.winners[0], text: `${names[0]} ganhou ${fmt(pr.amount)}${label}${pr.handName ? ` com ${pr.handName}` : ''}` });
    } else {
      ev.push({ type: 'win', text: `${nameList(names)} dividiram ${fmt(pr.amount)}${label}${pr.handName ? ` com ${pr.handName}` : ''}`, data: { seats: pr.winners } });
    }
  });
  finishHand(s);
}

/** Limpa a mão encerrada. Devolve true se uma nova mão pôde ser iniciada em seguida. */
export function clearHand(s: State): void {
  s.hand = [];
  s.board = [];
  s.deck = [];
  s.result = null;
  s.runout = false;
  s.toAct = -1;
  s.phase = 'idle';
}

export function seatPlayerOf(s: State, seat: number): SeatPlayer | null {
  return s.seats[seat]?.player ?? null;
}
