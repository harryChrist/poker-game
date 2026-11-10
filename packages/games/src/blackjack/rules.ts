import { deck52, makeCard, shuffle, type Card, type EngineError, type GameEvent } from '@cards/shared';
import type { Action, BJHand, Legal, Outcome, RoundEntry, State } from './types';

export const TIMING = { start: 1000, dealer: 700, result: 3000, retry: 3000 };
export const MAX_HANDS = 4;

export function createState(config: Record<string, number>): State {
  const seats = Math.max(1, Math.min(5, Math.floor(config.seats ?? 5)));
  const minBet = Math.max(1, Math.floor(config.minBet ?? 10));
  const maxBet = Math.max(minBet, Math.floor(config.maxBet ?? 1000));
  const decks = Math.max(1, Math.min(8, Math.floor(config.decks ?? 6)));
  const turnSeconds = Math.max(5, Math.floor(config.turnSeconds ?? 20));
  return {
    cfg: { seats, minBet, maxBet, decks, turnMs: turnSeconds * 1000 },
    seats: Array.from({ length: seats }, () => null),
    phase: 'idle', shoe: [], shoeGen: 0, round: 0, bets: [], entries: [], dealer: [], dealerHidden: true, toAct: null,
  };
}

/* ---------------- valores ---------------- */

export function cardValue(c: Card): number {
  if (c.r === 'A') return 11;
  if (c.r === 'T' || c.r === 'J' || c.r === 'Q' || c.r === 'K') return 10;
  return Number(c.r);
}

export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 1; } else total += cardValue(c);
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

export function isBlackjack(h: Pick<BJHand, 'cards' | 'fromSplit'>): boolean {
  return h.cards.length === 2 && !h.fromSplit && handValue(h.cards).total === 21;
}

export function handLabel(h: Pick<BJHand, 'cards' | 'fromSplit'>): string {
  const v = handValue(h.cards);
  if (v.total > 21) return 'estourou';
  if (isBlackjack(h)) return 'BJ';
  return v.soft ? `soft ${v.total}` : `${v.total}`;
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR');
}

/* ---------------- sapato ---------------- */

function newShoe(s: State, rng: () => number): void {
  s.shoeGen++;
  const cards: Card[] = [];
  for (let d = 0; d < s.cfg.decks; d++) {
    for (const c of deck52()) cards.push(makeCard(c.r, c.s, s.shoeGen * 100 + d + 1));
  }
  s.shoe = shuffle(cards, rng);
}

function draw(s: State, rng: () => number): Card {
  if (s.shoe.length === 0) newShoe(s, rng);
  return s.shoe.pop()!;
}

export function shoePercent(s: State): number {
  const total = s.cfg.decks * 52;
  return Math.round((s.shoe.length / total) * 100);
}

/* ---------------- apostas ---------------- */

export function bettorsPending(s: State): number[] {
  const out: number[] = [];
  s.seats.forEach((st, i) => {
    if (st && st.stack >= s.cfg.minBet && !s.bets.some((b) => b.seat === i)) out.push(i);
  });
  return out;
}

function anyoneCanBet(s: State): boolean {
  return s.seats.some((st) => st && st.stack >= s.cfg.minBet);
}

export function openBetting(s: State): boolean {
  s.entries = [];
  s.dealer = [];
  s.dealerHidden = true;
  s.toAct = null;
  s.bets = [];
  if (!anyoneCanBet(s)) { s.phase = 'idle'; return false; }
  s.round++;
  s.phase = 'betting';
  return true;
}

export function applyBet(s: State, seat: number, a: Action, rng: () => number, ev: GameEvent[]): { advanceInMs?: number } | EngineError {
  if (s.phase !== 'betting') return { error: 'As apostas não estão abertas.' };
  const st = s.seats[seat];
  if (!st) return { error: 'Você não está sentado.' };
  if (s.bets.some((b) => b.seat === seat)) return { error: 'Você já decidiu nesta rodada.' };
  if (st.stack < s.cfg.minBet) return { error: `Fichas insuficientes para a aposta mínima (${fmt(s.cfg.minBet)}).` };
  if (a.type === 'skip') {
    s.bets.push({ seat, amount: 0 });
    ev.push({ type: 'skip', seat, text: `${st.player.name} pulou a rodada` });
  } else if (a.type === 'bet') {
    const amount = (a as { amount: unknown }).amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount)) return { error: 'Valor de aposta inválido.' };
    if (amount < s.cfg.minBet) return { error: `A aposta mínima é ${fmt(s.cfg.minBet)}.` };
    if (amount > s.cfg.maxBet) return { error: `A aposta máxima é ${fmt(s.cfg.maxBet)}.` };
    if (amount > st.stack) return { error: 'Você não tem fichas suficientes.' };
    st.stack -= amount;
    st.lastBet = amount;
    s.bets.push({ seat, amount });
    ev.push({ type: 'bet', seat, text: `${st.player.name} apostou ${fmt(amount)}` });
  } else {
    return { error: 'Faça uma aposta ou pule a rodada.' };
  }
  return { advanceInMs: afterBetting(s, rng, ev) };
}

/** Se todos decidiram, distribui; se ninguém apostou, volta ao repouso. */
export function afterBetting(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  if (s.phase !== 'betting' || bettorsPending(s).length > 0) return undefined;
  if (s.bets.some((b) => b.amount > 0)) return deal(s, rng, ev);
  s.phase = 'idle';
  s.bets = [];
  return anyoneCanBet(s) ? TIMING.retry : undefined;
}

/* ---------------- distribuição ---------------- */

function deal(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  if (s.shoe.length < s.cfg.decks * 52 * 0.25) {
    newShoe(s, rng);
    ev.push({ type: 'shuffle', text: 'Sapato embaralhado' });
  }
  s.entries = s.bets.filter((b) => b.amount > 0 && s.seats[b.seat]).sort((a, b) => a.seat - b.seat).map((b) => {
    const st = s.seats[b.seat]!;
    const hand: BJHand = { cards: [], bet: b.amount, doubled: false, done: false, fromSplit: false, splitAces: false, outcome: null, payout: 0 };
    return {
      seat: b.seat, userId: st.player.userId, name: st.player.name, isBot: st.player.isBot,
      hands: [hand], insurance: 0, insDecided: false, left: false, net: null,
    } as RoundEntry;
  });
  s.dealer = [];
  s.dealerHidden = true;
  for (let round = 0; round < 2; round++) {
    for (const e of s.entries) e.hands[0].cards.push(draw(s, rng));
    s.dealer.push(draw(s, rng));
  }
  s.phase = 'playing';
  ev.push({ type: 'deal', text: 'Cartas distribuídas' });
  if (s.dealer[0].r === 'A') {
    s.phase = 'insurance';
    for (const e of s.entries) {
      const cost = Math.floor(e.hands[0].bet / 2);
      if (cost < 1 || (s.seats[e.seat]?.stack ?? 0) < cost) e.insDecided = true;
    }
    if (s.entries.every((e) => e.insDecided)) return peek(s, rng, ev);
    return undefined;
  }
  if (cardValue(s.dealer[0]) === 10) return peek(s, rng, ev);
  return startPlaying(s, ev);
}

function dealerBlackjack(s: State): boolean {
  return s.dealer.length === 2 && handValue(s.dealer).total === 21;
}

/** A banca confere o blackjack (Ás ou 10 aparente) */
function peek(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  void rng;
  if (dealerBlackjack(s)) {
    s.dealerHidden = false;
    ev.push({ type: 'dealerBlackjack', text: 'A banca tem blackjack' });
    settle(s, ev);
    return TIMING.result;
  }
  return startPlaying(s, ev);
}

function nextHand(s: State): { seat: number; hand: number } | null {
  for (const e of s.entries) {
    if (e.left) continue;
    for (let i = 0; i < e.hands.length; i++) if (!e.hands[i].done) return { seat: e.seat, hand: i };
  }
  return null;
}

function startPlaying(s: State, ev: GameEvent[]): number | undefined {
  for (const e of s.entries) for (const h of e.hands) if (isBlackjack(h)) h.done = true;
  s.phase = 'playing';
  return moveOn(s, ev);
}

/** Passa para a próxima mão pendente; sem mãos pendentes, vez da banca. */
function moveOn(s: State, ev: GameEvent[]): number | undefined {
  const n = nextHand(s);
  if (n) { s.toAct = n; return undefined; }
  s.toAct = null;
  s.phase = 'dealer';
  ev.push({ type: 'dealerTurn', text: 'Vez da banca' });
  return TIMING.dealer;
}

/* ---------------- seguro ---------------- */

export function insurancePending(s: State): number[] {
  return s.phase === 'insurance' ? s.entries.filter((e) => !e.left && !e.insDecided).map((e) => e.seat) : [];
}

export function applyInsurance(s: State, seat: number, a: Action, rng: () => number, ev: GameEvent[]): { advanceInMs?: number } | EngineError {
  if (s.phase !== 'insurance') return { error: 'O seguro não está aberto.' };
  const e = s.entries.find((x) => x.seat === seat && !x.left);
  if (!e) return { error: 'Você não está nesta rodada.' };
  if (e.insDecided) return { error: 'Você já decidiu sobre o seguro.' };
  if (a.type !== 'insurance') return { error: 'Decida sobre o seguro.' };
  if (a.take) {
    const cost = Math.floor(e.hands[0].bet / 2);
    const st = s.seats[seat]!;
    if (cost < 1) return { error: 'Aposta pequena demais para o seguro.' };
    if (st.stack < cost) return { error: 'Fichas insuficientes para o seguro.' };
    st.stack -= cost;
    e.insurance = cost;
    ev.push({ type: 'insurance', seat, text: `${e.name} fez seguro (${fmt(cost)})` });
  }
  e.insDecided = true;
  return { advanceInMs: afterInsurance(s, rng, ev) };
}

function afterInsurance(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  if (s.phase !== 'insurance') return undefined;
  if (s.entries.some((e) => !e.left && !e.insDecided)) return undefined;
  return peek(s, rng, ev);
}

/* ---------------- jogadas ---------------- */

function sameValue(a: Card, b: Card): boolean {
  return cardValue(a) === cardValue(b);
}

export function legalFor(s: State, seat: number): Legal | null {
  const base = { minBet: s.cfg.minBet, maxBet: 0, lastBet: 0, insuranceCost: 0, hand: 0, hit: false, stand: false, double: false, split: false };
  const st = s.seats[seat];
  if (!st) return null;
  if (s.phase === 'betting') {
    if (!bettorsPending(s).includes(seat)) return null;
    return { ...base, phase: 'betting', maxBet: Math.min(s.cfg.maxBet, st.stack), lastBet: st.lastBet };
  }
  if (s.phase === 'insurance') {
    const e = s.entries.find((x) => x.seat === seat && !x.left && !x.insDecided);
    if (!e) return null;
    return { ...base, phase: 'insurance', insuranceCost: Math.floor(e.hands[0].bet / 2) };
  }
  if (s.phase === 'playing' && s.toAct && s.toAct.seat === seat) {
    const e = s.entries.find((x) => x.seat === seat && !x.left);
    const h = e?.hands[s.toAct.hand];
    if (!e || !h) return null;
    const two = h.cards.length === 2;
    return {
      ...base, phase: 'playing', hand: s.toAct.hand,
      hit: !h.splitAces, stand: true,
      double: two && !h.splitAces && st.stack >= h.bet,
      split: two && !h.splitAces && e.hands.length < MAX_HANDS && sameValue(h.cards[0], h.cards[1]) && st.stack >= h.bet,
    };
  }
  return null;
}

export function applyPlay(s: State, seat: number, a: Action, rng: () => number, ev: GameEvent[]): { advanceInMs?: number } | EngineError {
  if (s.phase !== 'playing' || !s.toAct) return { error: 'Não é hora de jogar.' };
  if (s.toAct.seat !== seat) return { error: 'Não é a sua vez.' };
  const e = s.entries.find((x) => x.seat === seat && !x.left);
  const st = s.seats[seat];
  const h = e?.hands[s.toAct.hand];
  if (!e || !st || !h) return { error: 'Você não está nesta rodada.' };
  const legal = legalFor(s, seat)!;
  const idx = s.toAct.hand;
  switch (a.type) {
    case 'hit': {
      if (!legal.hit) return { error: 'Ases divididos recebem só uma carta.' };
      h.cards.push(draw(s, rng));
      const t = handValue(h.cards).total;
      if (t >= 21) h.done = true;
      ev.push({ type: 'hit', seat, text: `${e.name} pediu carta` });
      break;
    }
    case 'stand':
      h.done = true;
      ev.push({ type: 'stand', seat, text: `${e.name} parou` });
      break;
    case 'double': {
      if (h.cards.length !== 2) return { error: 'Só é possível dobrar com duas cartas.' };
      if (!legal.double) return { error: 'Você não tem fichas suficientes para dobrar.' };
      st.stack -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(draw(s, rng));
      h.done = true;
      ev.push({ type: 'double', seat, text: `${e.name} dobrou` });
      break;
    }
    case 'split': {
      if (!legal.split) {
        if (h.cards.length !== 2 || !sameValue(h.cards[0], h.cards[1])) return { error: 'Só é possível dividir duas cartas do mesmo valor.' };
        if (e.hands.length >= MAX_HANDS) return { error: `Máximo de ${MAX_HANDS} mãos.` };
        return { error: 'Você não tem fichas suficientes para dividir.' };
      }
      st.stack -= h.bet;
      const aces = h.cards[0].r === 'A';
      const second: BJHand = { cards: [h.cards[1]], bet: h.bet, doubled: false, done: false, fromSplit: true, splitAces: aces, outcome: null, payout: 0 };
      h.cards = [h.cards[0]];
      h.fromSplit = true;
      h.splitAces = aces;
      h.cards.push(draw(s, rng));
      second.cards.push(draw(s, rng));
      e.hands.splice(idx + 1, 0, second);
      for (const x of [h, second]) {
        if (x.splitAces || handValue(x.cards).total >= 21) x.done = true;
      }
      ev.push({ type: 'split', seat, text: `${e.name} dividiu` });
      break;
    }
    default:
      return { error: 'Ação inválida neste momento.' };
  }
  return { advanceInMs: afterPlay(s, ev) };
}

function afterPlay(s: State, ev: GameEvent[]): number | undefined {
  if (s.phase !== 'playing') return undefined;
  return moveOn(s, ev);
}

/* ---------------- banca ---------------- */

function liveHandsExist(s: State): boolean {
  return s.entries.some((e) => !e.left && e.hands.some((h) => h.outcome === null && handValue(h.cards).total <= 21 && !isBlackjack(h)));
}

function dealerNeedsDraw(s: State): boolean {
  return liveHandsExist(s) && handValue(s.dealer).total < 17; // S17: para em todo 17
}

export function advanceDealer(s: State, rng: () => number, ev: GameEvent[]): number | undefined {
  if (s.dealerHidden) {
    s.dealerHidden = false;
    ev.push({ type: 'reveal', text: 'A banca revelou a carta' });
    if (dealerNeedsDraw(s)) return TIMING.dealer;
  } else if (dealerNeedsDraw(s)) {
    s.dealer.push(draw(s, rng));
    ev.push({ type: 'dealerDraw', text: 'A banca pediu carta' });
    if (dealerNeedsDraw(s)) return TIMING.dealer;
  }
  settle(s, ev);
  return TIMING.result;
}

/* ---------------- pagamentos ---------------- */

export function settle(s: State, ev: GameEvent[]): void {
  const dv = handValue(s.dealer).total;
  const dBJ = dealerBlackjack(s);
  s.dealerHidden = false;
  for (const e of s.entries) {
    let net = 0;
    for (const h of e.hands) {
      let outcome: Outcome;
      let payout = 0;
      if (e.left || h.outcome !== null) {
        outcome = 'lose';
      } else {
        const pv = handValue(h.cards).total;
        if (pv > 21) outcome = 'bust';
        else if (isBlackjack(h)) {
          if (dBJ) { outcome = 'push'; payout = h.bet; } else { outcome = 'blackjack'; payout = h.bet + Math.floor((h.bet * 3) / 2); }
        } else if (dBJ) outcome = 'lose';
        else if (dv > 21 || pv > dv) { outcome = 'win'; payout = h.bet * 2; }
        else if (pv === dv) { outcome = 'push'; payout = h.bet; }
        else outcome = 'lose';
      }
      h.outcome = outcome;
      h.payout = payout;
      h.done = true;
      net += payout - h.bet;
    }
    if (e.insurance > 0) {
      if (dBJ) net += e.insurance * 2; else net -= e.insurance;
    }
    e.net = net;
    const st = s.seats[e.seat];
    if (!e.left && st) {
      let total = e.hands.reduce((a, h) => a + h.payout, 0);
      if (dBJ && e.insurance > 0) total += e.insurance * 3;
      st.stack += total;
      ev.push({ type: 'result', seat: e.seat, text: `${e.name}: ${net > 0 ? `+${fmt(net)}` : net < 0 ? `-${fmt(-net)}` : 'empate'}` });
    }
  }
  s.toAct = null;
  s.phase = 'result';
}

/* ---------------- saída de jogador ---------------- */

/** Remove o jogador da rodada em andamento. Devolve fichas devolvidas (aposta ainda não distribuída) e advanceInMs. */
export function leaveRound(s: State, seat: number, rng: () => number, ev: GameEvent[]): { refund: number; advanceInMs?: number } {
  let refund = 0;
  let adv: number | undefined;
  if (s.phase === 'betting') {
    const b = s.bets.find((x) => x.seat === seat);
    if (b) { refund = b.amount; s.bets = s.bets.filter((x) => x.seat !== seat); }
    // o assento será removido: não deve contar como pendente
    const st = s.seats[seat];
    s.seats[seat] = null;
    adv = afterBetting(s, rng, ev);
    s.seats[seat] = st;
    return { refund, advanceInMs: adv };
  }
  const e = s.entries.find((x) => x.seat === seat && !x.left);
  if (!e) return { refund: 0 };
  e.left = true;
  if (s.phase === 'insurance') {
    e.insDecided = true;
    adv = afterInsurance(s, rng, ev);
  } else if (s.phase === 'playing') {
    for (const h of e.hands) { h.done = true; h.outcome = 'lose'; }
    if (s.toAct && s.toAct.seat === seat) adv = moveOn(s, ev);
    else if (!nextHand(s)) adv = moveOn(s, ev);
  } else if (s.phase === 'dealer') {
    for (const h of e.hands) { h.outcome = 'lose'; }
  }
  return { refund: 0, advanceInMs: adv };
}
