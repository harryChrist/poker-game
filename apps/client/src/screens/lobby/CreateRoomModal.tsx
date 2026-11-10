import { useState } from 'react';
import { GAME_LIST, GAMES, resolveConfig, type ConfigField, type GameId } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { Modal } from '../../ui/Modal';
import { Switch } from '../../ui/widgets';

function defaultsFor(gameId: GameId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of GAMES[gameId].configFields) out[f.key] = String(f.default);
  return out;
}

/** Validações cruzadas simples antes de enviar */
function validate(gameId: GameId, cfg: Record<string, number>): string | null {
  const pairs: [string, string, string][] = [
    ['minBuyIn', 'maxBuyIn', 'A entrada mínima não pode ser maior que a máxima.'],
    ['minBet', 'maxBet', 'A aposta mínima não pode ser maior que a máxima.'],
    ['smallBlind', 'bigBlind', 'O small blind não pode ser maior que o big blind.'],
  ];
  for (const [a, b, msg] of pairs) {
    if (a in cfg && b in cfg && cfg[a] > cfg[b]) return msg;
  }
  return GAMES[gameId] ? null : 'Jogo inválido.';
}

export function CreateRoomModal({ onClose, defaultGame }: { onClose: () => void; defaultGame?: GameId }) {
  const me = useStore((s) => s.me)!;
  const setRoom = useStore((s) => s.setRoom);
  const [gameId, setGameId] = useState<GameId>(defaultGame ?? 'poker');
  const [values, setValues] = useState<Record<string, string>>(() => defaultsFor(defaultGame ?? 'poker'));
  const [name, setName] = useState(`Mesa de ${me.username}`);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const game = GAMES[gameId];

  const pick = (id: GameId) => {
    setGameId(id);
    setValues(defaultsFor(id));
    setError(null);
  };

  const submit = async () => {
    const parsed: Record<string, number> = {};
    for (const f of game.configFields) parsed[f.key] = Number(values[f.key]);
    const config = resolveConfig(gameId, parsed);
    const problem = validate(gameId, config);
    if (problem) return setError(problem);
    if (!name.trim()) return setError('Dê um nome à sala.');
    setBusy(true);
    setError(null);
    const res = await act('room:create', { gameId, name: name.trim(), isPrivate, config }, { silent: true });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setRoom(res.data);
    onClose();
  };

  return (
    <Modal title="Criar sala" onClose={onClose} width={460}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>Criar sala</button>
      </>}>
      <div className="stack">
        <div>
          <span className="label">Jogo</span>
          <div className="game-grid">
            {GAME_LIST.map((g) => (
              <button key={g.id} type="button" className={`game-tile ${g.id === gameId ? 'game-tile-on' : ''}`} onClick={() => pick(g.id)}>
                <strong>{g.name}</strong>
                <span>{g.economy === 'session' ? 'mesa livre' : 'partida com aposta'}</span>
              </button>
            ))}
          </div>
          <p className="muted-text small">{game.description}</p>
        </div>

        <label className="field">
          <span className="label">Nome da sala</span>
          <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="config-grid">
          {game.configFields.map((f) => (
            <ConfigInput key={`${gameId}.${f.key}`} field={f} value={values[f.key] ?? ''}
              onChange={(v) => setValues((cur) => ({ ...cur, [f.key]: v }))} />
          ))}
        </div>

        <Switch checked={isPrivate} onChange={setIsPrivate} label="Sala privada (só entra quem tem o código)" />

        {error && <div className="banner banner-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function ConfigInput({ field, value, onChange }: { field: ConfigField; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field" title={field.help}>
      <span className="label">{field.label}</span>
      {field.type === 'select' ? (
        <select className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input className="input" type="number" inputMode="numeric" value={value} min={field.min} max={field.max} step={field.step}
          onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <span className="hint">{field.help}</span>}
    </label>
  );
}
