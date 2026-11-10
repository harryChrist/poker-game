import { useState } from 'react';
import { GAMES, type RoomState } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { Chips } from '../../ui/cards';
import { IconCrown } from '../../ui/icons';
import { kickUser, notReady, ReadyBadge, ReadyToggle, waitingText } from './players';

/** Painel de pré-partida dos jogos "match": assentos, apostas e botão Começar */
export function PreMatch({ room, mySeat, isHost }: { room: RoomState; mySeat: number | null; isHost: boolean }) {
  const balance = useStore((s) => s.me?.balance ?? 0);
  const [busy, setBusy] = useState(false);
  const game = GAMES[room.gameId];
  const stake = room.config.stake ?? 0;
  const teams = !!game.teamsWhen4 && room.seats.length === 4;
  const humans = room.seats.filter((s) => s && !s.isBot).length;
  const emptySeats = room.seats.filter((s) => !s).length;
  const canAfford = balance >= stake;
  const waiting = waitingText(room);

  const start = async () => {
    setBusy(true);
    await act('room:start', {});
    setBusy(false);
  };

  return (
    <div className="prematch">
      <div className="prematch-info">
        <div className="between">
          <span className="muted-text">Aposta por jogador</span>
          <Chips amount={stake} />
        </div>
        <div className="between">
          <span className="muted-text">Pote ({room.seats.length} lugares)</span>
          <Chips amount={stake * room.seats.length} />
        </div>
        {!canAfford && mySeat === null && (
          <div className="banner banner-warn">Seu saldo ({balance.toLocaleString('pt-BR')}) não cobre a aposta.</div>
        )}
        {room.lastResult && <div className="muted-text small">Última partida: {room.lastResult.summary}</div>}
      </div>

      <div className="seat-list">
        {room.seats.map((s, i) => {
          const team = teams ? (i % 2 === 0 ? 'Dupla A' : 'Dupla B') : null;
          return (
            <div key={i} className={`seat-card ${s ? '' : 'seat-card-empty'} ${mySeat === i ? 'seat-card-me' : ''} ${teams ? `team-${i % 2}` : ''}`}>
              <div className="seat-card-main">
                <span className="seat-card-n">{i + 1}</span>
                <div className="seat-card-who">
                  {s ? (
                    <>
                      <span className="seat-card-name" title={s.name}>
                        {s.isBot ? '🤖 ' : ''}{s.name}
                        {s.userId === room.hostUserId && <IconCrown width={11} height={11} className="crown" />}
                      </span>
                      <span className="seat-card-badges">
                        <ReadyBadge room={room} seat={s} />
                        {!s.connected && !s.isBot && <span className="neg small">desconectado</span>}
                      </span>
                    </>
                  ) : <span className="muted-text">Lugar vazio</span>}
                  {team && <span className="small muted-text">{team}</span>}
                </div>
              </div>
              <div className="seat-card-actions">
                {!s && mySeat === null && (
                  <button type="button" className="btn btn-sm" onClick={() => void act('room:sit', { seat: i })}>Sentar</button>
                )}
                {!s && isHost && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act('room:addBot', { seat: i })}>+ Bot</button>
                )}
                {s?.isBot && isHost && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act('room:removeBot', { seat: i })}>Remover</button>
                )}
                {mySeat === i && s && !isHost && <ReadyToggle seat={s} />}
                {mySeat === i && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act('room:stand', {})}>Levantar</button>
                )}
                {s && !s.isBot && isHost && s.userId !== room.hostUserId && (
                  <button type="button" className="btn btn-sm btn-ghost neg" onClick={() => void kickUser(s.userId, s.name)}>Remover</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {room.spectators.length > 0 && (
        <p className="muted-text small spectators">
          Assistindo:{' '}
          {room.spectators.map((s, k) => (
            <span key={s.userId}>
              {k > 0 && ', '}{s.name}
              {isHost && s.userId !== room.hostUserId && (
                <button type="button" className="link-btn neg" title={`Remover ${s.name}`} onClick={() => void kickUser(s.userId, s.name)}>×</button>
              )}
            </span>
          ))}
        </p>
      )}

      <div className="prematch-foot">
        {isHost ? (
          <>
            <button type="button" className="btn btn-primary btn-block" disabled={busy || humans === 0 || notReady(room).length > 0} onClick={() => void start()}>
              Começar partida
            </button>
            {waiting && <span className="small">{waiting}</span>}
            {emptySeats > 0 && <span className="muted-text small">Lugares vazios serão preenchidos com bots.</span>}
          </>
        ) : (
          <span className="muted-text">{mySeat !== null && room.seats[mySeat] && !room.seats[mySeat]!.ready ? 'Marque "Estou pronto" para o líder poder começar.' : 'Aguardando o líder começar a partida…'}</span>
        )}
      </div>
    </div>
  );
}
