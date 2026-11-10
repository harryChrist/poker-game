import type { EngineCtx } from '@cards/shared';
import type { Action, BiscaState } from './types';
import { canSwapTrump, cardPoints, cheapFirst, lowestValue, rankPower, teamOf, trickWinner } from './rules';

export function timeoutAction(s: BiscaState, seat: number): Action {
  return { type: 'play', cardId: lowestValue(s.hands[seat]).id };
}

export function botAction(s: BiscaState, seat: number, _ctx: EngineCtx): Action {
  const hand = s.hands[seat];
  const trump = s.trumpSuit;
  if (canSwapTrump(hand, s.stock.length, trump)) return { type: 'swapTrump' };

  const play = (id: string): Action => ({ type: 'play', cardId: id });
  const cheap = hand.slice().sort((a, b) => cheapFirst(a, b, trump));
  const myTeam = teamOf(seat, s.n);

  // Abrindo a vaza: joga lixo (sem trunfo, sem pontos)
  if (s.table.length === 0) return play(cheap[0].id);

  const win = trickWinner(s.table, trump);
  const tablePoints = s.table.reduce((sum, p) => sum + cardPoints(p.card), 0);
  const partnerWinning = s.n === 4 && teamOf(win.seat, s.n) === myTeam;

  if (partnerWinning) {
    // Último a jogar (ou parceiro com trunfo): carrega pontos sem gastar trunfo
    const last = s.table.length === s.n - 1;
    if (last || win.card.s === trump) {
      const carry = hand.filter((c) => c.s !== trump).sort((a, b) => cardPoints(b) - cardPoints(a) || rankPower(b) - rankPower(a));
      if (carry.length > 0 && cardPoints(carry[0]) > 0) return play(carry[0].id);
    }
    return play(cheap[0].id);
  }

  // Cartas que vencem a vaza agora
  const winners = hand
    .filter((c) => trickWinner([...s.table, { seat, card: c }], trump).seat === seat)
    .sort((a, b) => cheapFirst(a, b, trump));
  if (winners.length > 0) {
    const w = winners[0];
    const usesTrump = w.s === trump && win.card.s !== trump;
    const worth = tablePoints >= 4 || cardPoints(win.card) >= 3;
    // Gastar trunfo só quando a vaza vale a pena; sem trunfo, ganhar com o menor possível
    if (!usesTrump || worth || s.stock.length === 0) {
      // Não desperdiça um ás/7 para ganhar vaza sem pontos
      if (tablePoints > 0 || cardPoints(w) <= 4) return play(w.id);
    }
  }
  return play(cheap[0].id);
}
