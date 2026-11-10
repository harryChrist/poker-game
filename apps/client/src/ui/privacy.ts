import { useSyncExternalStore } from 'react';

/**
 * "Esconder minhas cartas": a mão do jogador aparece virada para baixo e só é revelada
 * passando o mouse (ou segurando o dedo) em cima. Fica salvo neste aparelho.
 * As telas marcam a própria mão com <Hand mine /> (ou a classe "hand-mine");
 * o efeito é todo em CSS (cards.css), ativado pela classe "hide-my-cards" na sala.
 */
const KEY = 'mesa.hideMyCards';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let value = read();

export function setHideMyCards(next: boolean): void {
  value = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* sem storage: vale só nesta sessão */
  }
  listeners.forEach((l) => l());
}

export function useHideMyCards(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => value,
  );
}
