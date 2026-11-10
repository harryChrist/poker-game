import type { MaybeCard } from '@cards/shared';
import { computePots, legalFor, potTotal, entryFor } from './rules';
import type { SeatView, State, View } from './types';

export function buildView(s: State, viewer: number | null): View {
  const inProgress = s.phase !== 'idle';
  const showdown = s.phase === 'result' ? !!s.result?.showdown : s.runout;
  const res = s.result;
  const winSeats = new Set<number>();
  const winningIds = new Set<string>();
  if (res?.showdown) {
    for (const pot of res.pots) if (!pot.refund) pot.winners.forEach((w) => winSeats.add(w));
    for (const h of res.hands) if (winSeats.has(h.seat)) h.best.forEach((id) => winningIds.add(id));
  }

  const seats: (SeatView | null)[] = s.seats.map((st, i) => {
    if (!st) return null;
    const e = entryFor(s, i);
    const mine = viewer === i;
    let cards: MaybeCard[] = [];
    if (e) {
      if (mine || (showdown && !e.folded)) cards = e.cards.map((c) => ({ ...c }));
      else if (!e.folded) cards = e.cards.map(() => ({ hidden: true as const }));
    }
    const sh = res?.showdown ? res.hands.find((h) => h.seat === i) : undefined;
    const won = res?.winners.find((w) => w.seat === i)?.amount;
    return {
      seat: i, userId: st.player.userId, name: st.player.name, isBot: st.player.isBot,
      stack: st.stack, pending: st.pending,
      bet: e?.bet ?? 0, total: e?.total ?? 0,
      inHand: !!e, folded: !!e?.folded, allIn: !!e?.allIn,
      sittingOut: st.stack + st.pending === 0 && !e,
      waiting: !e && st.stack + st.pending > 0,
      isDealer: inProgress && s.button === i,
      isSB: inProgress && s.sbSeat === i && !!e,
      isBB: inProgress && s.bbSeat === i && !!e,
      cards,
      last: e?.last ?? '',
      handName: sh?.handName,
      bestIds: sh?.best,
      won,
    };
  });

  const pots = computePots(s.hand.map((p) => ({ seat: p.seat, amount: p.total, live: !p.folded })))
    .filter((p) => p.eligible.length >= 2).map((p) => p.amount);

  return {
    mySeat: viewer,
    phase: s.phase === 'idle' ? 'waiting'
      : s.phase === 'betting' ? 'betting'
        : s.phase === 'reveal' ? (s.runout ? 'runout' : 'between')
          : 'result',
    street: s.street,
    handNo: s.handNo,
    smallBlind: s.cfg.sb,
    bigBlind: s.cfg.bb,
    seats,
    board: s.board.map((c) => ({ ...c })),
    pot: s.phase === 'result' ? (res?.total ?? 0) : potTotal(s),
    pots: pots.length > 1 ? pots : [],
    button: s.button,
    turnSeat: s.phase === 'betting' ? s.toAct : null,
    currentBet: s.currentBet,
    showdown,
    legal: viewer !== null ? legalFor(s, viewer) : null,
    result: res ? { showdown: res.showdown, total: res.total, pots: res.pots, winners: res.winners } : null,
    winningIds: [...winningIds],
  };
}
