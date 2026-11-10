import type { MaybeCard } from '@cards/shared';
import { bettorsPending, handLabel, handValue, insurancePending, isBlackjack, legalFor, shoePercent } from './rules';
import type { DealerView, HandView, SeatView, State, View } from './types';

function turnSeats(s: State): number[] {
  if (s.phase === 'betting') return bettorsPending(s);
  if (s.phase === 'insurance') return insurancePending(s);
  if (s.phase === 'playing' && s.toAct) return [s.toAct.seat];
  return [];
}

export function buildView(s: State, viewer: number | null): View {
  const resultShown = s.phase === 'result';
  const seats: (SeatView | null)[] = s.seats.map((st, i) => {
    if (!st) return null;
    const e = s.entries.find((x) => x.seat === i && !x.left);
    const decision = s.bets.find((b) => b.seat === i);
    const hands: HandView[] = (e?.hands ?? []).map((h, hi) => {
      const v = handValue(h.cards);
      return {
        cards: h.cards.map((c) => ({ ...c })),
        bet: h.bet, total: v.total, soft: v.soft, label: handLabel(h),
        isBlackjack: isBlackjack(h), bust: v.total > 21, done: h.done, doubled: h.doubled,
        active: s.phase === 'playing' && s.toAct?.seat === i && s.toAct.hand === hi,
        outcome: resultShown ? h.outcome : null,
        net: resultShown ? h.payout - h.bet : null,
      };
    });
    return {
      seat: i, userId: st.player.userId, name: st.player.name, isBot: st.player.isBot,
      stack: st.stack, lastBet: st.lastBet,
      inRound: !!e,
      decided: !!decision,
      betPlaced: decision?.amount ?? 0,
      hands,
      insurance: e?.insurance ?? 0,
      insuranceDecided: !!e?.insDecided,
      net: resultShown && e ? e.net : null,
      sittingOut: st.stack < s.cfg.minBet && !e && !decision,
    };
  });

  const dealerCards: MaybeCard[] = s.dealer.map((c, i) => (i === 1 && s.dealerHidden ? { hidden: true as const } : { ...c }));
  const visible = s.dealer.filter((_, i) => !(i === 1 && s.dealerHidden));
  const dv = visible.length ? handValue(visible) : null;
  const dealer: DealerView = {
    cards: dealerCards,
    total: dv ? dv.total : null,
    label: !dv ? '' : s.dealerHidden ? (visible[0].r === 'A' ? 'A' : `${dv.total}`)
      : dv.total > 21 ? 'estourou' : (s.dealer.length === 2 && dv.total === 21) ? 'BJ' : dv.soft ? `soft ${dv.total}` : `${dv.total}`,
    hidden: s.dealerHidden && s.dealer.length > 1,
    bust: !!dv && !s.dealerHidden && dv.total > 21,
    isBlackjack: !s.dealerHidden && s.dealer.length === 2 && !!dv && dv.total === 21,
  };

  return {
    mySeat: viewer,
    phase: s.phase === 'idle' ? 'waiting' : s.phase,
    round: s.round,
    minBet: s.cfg.minBet,
    maxBet: s.cfg.maxBet,
    seats,
    dealer,
    toAct: s.phase === 'playing' ? s.toAct : null,
    turnSeats: turnSeats(s),
    shoePct: shoePercent(s),
    legal: viewer !== null ? legalFor(s, viewer) : null,
  };
}

export { turnSeats };
