import { useState } from 'react';
import { GAMES, type RoomState } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { Chips } from '../../ui/cards';
import { IconCrown, IconEye } from '../../ui/icons';
import { kickUser, notReady, ReadyBadge, ReadySummary, ReadyToggle } from './players';

/** Painel de pré-partida dos jogos "match": assentos, apostas e botão Começar */
export function PreMatch({ room, mySeat, isHost }: { room: RoomState; mySeat: number | null; isHost: boolean }) {
  const balance = useStore((s) => s.me?.balance ?? 0);
  const [busy, setBusy] = useState(false);
  const game = GAMES[room.gameId];
  const stake = room.config.stake ?? 0;
  const teams = !!game.teamsWhen4 && room.seats.length === 4;
  const humans = room.seats.filter((s) => s && !s.isBot).length;
  const taken = room.seats.filter(Boolean).length;
  const emptySeats = room.seats.length - taken;
  const canAfford = balance >= stake;
  const me = mySeat !== null ? room.seats[mySeat] : null;
  const canStart = !busy && humans > 0 && notReady(room).length === 0;

  const start = async () => {
    setBusy(true);
    await act('room:start', {});
    setBusy(false);
  };

  return (
    <div className="prematch">
      <div className="pm-body">
        <div className="pm-stats">
          <div className="pm-stat"><span>Aposta por jogador</span><Chips amount={stake} /></div>
          <div className="pm-stat"><span>Pote ({room.seats.length} lugares)</span><Chips amount={stake * room.seats.length} /></div>
        </div>
        {!canAfford && mySeat === null && (
          <div className="banner banner-warn">Seu saldo ({balance.toLocaleString('pt-BR')}) não cobre a aposta.</div>
        )}
        {room.lastResult && <div className="muted-text small pm-last">Última partida: {room.lastResult.summary}</div>}

        <div className="pm-sec"><h3>Jogadores</h3><span>{taken}/{room.seats.length}</span></div>
        <div className="seat-list">
          {room.seats.map((s, i) => {
            const team = teams ? (i % 2 === 0 ? 'Dupla A' : 'Dupla B') : null;
            const mine = mySeat === i;
            const off = !!s && !s.isBot && !s.connected;
            return (
              <div key={i} className={`seat-card${s ? '' : ' seat-card-empty'}${mine ? ' seat-card-me' : ''}${off ? ' seat-card-off' : ''}${teams ? ` team-${i % 2}` : ''}`}>
                <div className="seat-card-main">
                  <span className="seat-card-n">{i + 1}</span>
                  <div className="seat-card-who">
                    {s ? (
                      <>
                        <span className="seat-card-name" title={s.name}>
                          <span className="seat-name-txt">{s.isBot ? '🤖 ' : ''}{s.name}</span>
                          {s.userId === room.hostUserId && <IconCrown width={11} height={11} className="crown" />}
                          {mine && <span className="seat-you">você</span>}
                        </span>
                        <span className="seat-card-badges">
                          {s.isBot ? <span className="pill">bot</span> : <ReadyBadge room={room} seat={s} />}
                          {off && <span className="pill pill-off">desconectado</span>}
                          {team && <span className={`pill-team team-t${i % 2}`}>{team}</span>}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="seat-empty-txt">Lugar vazio</span>
                        {team && <span className="seat-card-badges"><span className={`pill-team team-t${i % 2}`}>{team}</span></span>}
                      </>
                    )}
                  </div>
                </div>
                <div className="seat-card-actions">
                  {!s && mySeat === null && (
                    <button type="button" className="btn btn-sm btn-seat" onClick={() => void act('room:sit', { seat: i })}>Sentar</button>
                  )}
                  {!s && isHost && (
                    <button type="button" className="btn btn-sm btn-ghost-line" onClick={() => void act('room:addBot', { seat: i })}>+ Bot</button>
                  )}
                  {s?.isBot && isHost && (
                    <button type="button" className="btn btn-sm btn-ghost-line" onClick={() => void act('room:removeBot', { seat: i })}>Remover</button>
                  )}
                  {mine && (
                    <button type="button" className="btn btn-sm btn-ghost-line" onClick={() => void act('room:stand', {})}>Levantar</button>
                  )}
                  {s && !s.isBot && isHost && s.userId !== room.hostUserId && (
                    <button type="button" className="btn btn-sm btn-ghost-line neg" onClick={() => void kickUser(s.userId, s.name)}>Remover</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {room.spectators.length > 0 && (
          <p className="muted-text small spectators">
            <IconEye width={12} height={12} /> Assistindo:{' '}
            {room.spectators.map((s, k) => (
              <span key={s.userId}>
                {k > 0 && ', '}{s.name}
                {isHost && s.userId !== room.hostUserId && (
                  <button type="button" className="link-btn neg" title={`Remover ${s.name}`} aria-label={`Remover ${s.name}`} onClick={() => void kickUser(s.userId, s.name)}>×</button>
                )}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="pm-foot">
        <ReadySummary room={room} />
        {isHost ? (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={!canStart} onClick={() => void start()}>
              Começar partida
            </button>
            {emptySeats > 0 && <span className="pm-hint">Lugares vazios serão preenchidos com bots.</span>}
          </>
        ) : me ? (
          <>
            <ReadyToggle seat={me} block />
            <span className="pm-hint">{me.ready ? 'Tudo certo! Aguardando o líder começar.' : 'Marque “Estou pronto” para o líder poder começar.'}</span>
          </>
        ) : (
          <span className="pm-hint pm-hint-spec">
            {emptySeats > 0 ? 'Você está assistindo. Sente num lugar vazio para jogar.' : 'Você está assistindo. A mesa está cheia.'}
          </span>
        )}
      </div>
    </div>
  );
}
