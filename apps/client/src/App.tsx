import { useEffect } from 'react';
import { initNet } from './net/actions';
import { Login, Splash } from './screens/Login';
import { Lobby } from './screens/Lobby';
import { Room } from './screens/Room';
import { SettingsModal } from './screens/Settings';
import { useStore } from './store';
import { DialogHost } from './ui/dialogs';
import { TitleBar } from './ui/TitleBar';
import { Toasts } from './ui/Toasts';

export function App() {
  const me = useStore((s) => s.me);
  const room = useStore((s) => s.room);
  const booting = useStore((s) => s.booting);
  const conn = useStore((s) => s.conn);
  const settingsOpen = useStore((s) => s.settingsOpen);

  useEffect(() => initNet(), []);

  return (
    <div className="app">
      <TitleBar />
      {me && conn !== 'online' && (
        <div className="conn-banner">{conn === 'offline' ? 'Sem conexão — tentando reconectar…' : 'Reconectando…'}</div>
      )}
      <main className="app-main">
        {booting ? <Splash /> : !me ? <Login /> : room ? <Room /> : <Lobby />}
      </main>
      <Toasts />
      {settingsOpen && <SettingsModal />}
      <DialogHost />
    </div>
  );
}
