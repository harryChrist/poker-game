import { useState } from 'react';
import { GAME_LIST, GAMES, type GameId } from '@cards/shared';
import { GENERAL_TUTORIAL, TUTORIALS, type TutorialSection } from '../../tutorials';
import { Modal } from '../../ui/Modal';

type Pick = GameId | 'geral';

function Sections({ sections }: { sections: TutorialSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="tut-section">
          <h4>{s.title}</h4>
          <ul>{s.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </section>
      ))}
    </>
  );
}

/** Conteúdo do tutorial de um jogo (usado na aba e no modal da sala) */
export function GameTutorial({ gameId }: { gameId: GameId }) {
  const t = TUTORIALS[gameId];
  const meta = GAMES[gameId];
  return (
    <div className="tut-body">
      <p className="tut-intro">{t.intro}</p>
      <p className="muted-text small">
        {meta.playerCounts.length > 1
          ? `${meta.playerCounts[0]} a ${meta.playerCounts[meta.playerCounts.length - 1]} jogadores`
          : `${meta.playerCounts[0]} jogadores`}
        {meta.teamsWhen4 ? ' · com 4, joga em duplas' : ''}
        {meta.economy === 'session' ? ' · entra e sai da mesa quando quiser' : ' · partida com aposta'}
      </p>
      <Sections sections={t.sections} />
    </div>
  );
}

/** Aba "Como jogar" do lobby */
export function TutorialTab() {
  const [pick, setPick] = useState<Pick>('geral');
  return (
    <div className="tut">
      <div className="tut-picker">
        <button type="button" className={`tut-chip ${pick === 'geral' ? 'tut-chip-on' : ''}`} onClick={() => setPick('geral')}>Salas e fichas</button>
        {GAME_LIST.map((g) => (
          <button key={g.id} type="button" className={`tut-chip ${pick === g.id ? 'tut-chip-on' : ''}`} onClick={() => setPick(g.id)}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="tut-content">
        {pick === 'geral' ? (
          <div className="tut-body">
            <h3>Salas e fichas</h3>
            <Sections sections={GENERAL_TUTORIAL} />
          </div>
        ) : (
          <>
            <h3>{GAMES[pick].name}</h3>
            <GameTutorial gameId={pick} />
          </>
        )}
      </div>
    </div>
  );
}

/** Modal "Como jogar" aberto pelo botão "?" dentro da sala */
export function TutorialModal({ gameId, onClose }: { gameId: GameId; onClose: () => void }) {
  return (
    <Modal title={`Como jogar: ${GAMES[gameId].name}`} onClose={onClose} width={520}>
      <GameTutorial gameId={gameId} />
    </Modal>
  );
}
