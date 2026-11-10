import { useState, type CSSProperties } from 'react';
import { GAME_LIST, GAMES, type GameId } from '@cards/shared';
import { GENERAL_TUTORIAL, TUTORIALS, type TutorialSection } from '../../tutorials';
import { GAME_ART } from '../../ui/gameArt';
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
  const art = pick === 'geral' ? null : GAME_ART[pick];
  return (
    <div className="lb-tut">
      <div className="lb-chips lb-chips-sticky" role="tablist" aria-label="Escolha o assunto">
        <button type="button" role="tab" aria-selected={pick === 'geral'} className={`lb-chip ${pick === 'geral' ? 'lb-chip-on' : ''}`} onClick={() => setPick('geral')}>
          Salas e fichas
        </button>
        {GAME_LIST.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={pick === g.id} className={`lb-chip ${pick === g.id ? 'lb-chip-on' : ''}`}
            style={{ '--gc': GAME_ART[g.id].color } as CSSProperties} onClick={() => setPick(g.id)}>
            <i className="lb-chip-ico">{GAME_ART[g.id].icon}</i>{g.name.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="lb-tut-content" key={pick}>
        <div className="lb-tut-head" style={{ '--gc': art?.color ?? '#17694a' } as CSSProperties}>
          <span className="lb-ico">{art?.icon ?? '♠'}</span>
          <div>
            <h3>{pick === 'geral' ? 'Salas e fichas' : GAMES[pick].name}</h3>
            <p>{art ? art.tagline : 'Como funcionam as mesas, o saldo e os bônus'}</p>
          </div>
        </div>
        {pick === 'geral' ? (
          <div className="tut-body"><Sections sections={GENERAL_TUTORIAL} /></div>
        ) : (
          <GameTutorial gameId={pick} />
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
