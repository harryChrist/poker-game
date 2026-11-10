import { useCallback, useEffect, useRef, useState } from 'react';

/** Envia ações evitando cliques duplicados e transforma erros em uma mensagem curta que some sozinha. */
export function useActionSender<A>(sendAction: (a: A) => Promise<{ ok: boolean; error?: string }>) {
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    setError(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setError(null), 3500);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const send = useCallback(async (a: A): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    try {
      const r = await sendAction(a);
      if (!r.ok) { show(r.error || 'Jogada inválida.'); return false; }
      setError(null);
      return true;
    } catch {
      show('Falha ao enviar. Tente de novo.');
      return false;
    } finally {
      busy.current = false;
    }
  }, [sendAction, show]);

  return { send, error };
}
