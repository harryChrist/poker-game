import { useState } from 'react';
import { act } from '../net/actions';
import { useStore } from '../store';
import { Chips } from '../ui/cards';
import { fmtCountdown, useNow } from '../ui/format';
import { Tabs } from '../ui/widgets';
import { AdminTab } from './lobby/AdminTab';
import { HistoryTab } from './lobby/HistoryTab';
import { RankingTab } from './lobby/RankingTab';
import { RoomsTab } from './lobby/RoomsTab';

type TabId = 'rooms' | 'ranking' | 'history' | 'admin';

export function Lobby() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<TabId>('rooms');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'rooms', label: 'Salas' },
    { id: 'ranking', label: 'Ranking' },
    { id: 'history', label: 'Histórico' },
  ];
  if (me.role === 'admin') tabs.push({ id: 'admin', label: 'Admin' });

  return (
    <div className="lobby">
      <WalletHeader />
      <Tabs<TabId> tabs={tabs} value={tab} onChange={setTab} />
      <div className="lobby-body">
        {tab === 'rooms' && <RoomsTab />}
        {tab === 'ranking' && <RankingTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'admin' && me.role === 'admin' && <AdminTab />}
      </div>
    </div>
  );
}

function WalletHeader() {
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const toast = useStore((s) => s.toast);
  const now = useNow(1000);
  const [busy, setBusy] = useState<'refill' | 'daily' | null>(null);

  const refillWait = me.refillAvailableAt && me.refillAvailableAt > now ? me.refillAvailableAt - now : 0;
  const dailyWait = me.dailyAvailableAt && me.dailyAvailableAt > now ? me.dailyAvailableAt - now : 0;

  const claim = async (kind: 'refill' | 'daily') => {
    setBusy(kind);
    const res = await act(kind === 'refill' ? 'wallet:refill' : 'wallet:daily', {});
    setBusy(null);
    if (res.ok) {
      setMe(res.data);
      toast('success', kind === 'refill' ? 'Recarga concluída!' : 'Bônus diário resgatado!');
    }
  };

  return (
    <section className="wallet">
      <div className="wallet-id">
        <span className="wallet-user" title={me.username}>{me.username}</span>
        {me.role === 'admin' && <span className="badge badge-accent">admin</span>}
      </div>
      <div className="wallet-numbers">
        <div className="wallet-balance"><Chips amount={me.balance} /></div>
        <div className="wallet-sub">
          em jogo: <strong>{me.inPlay.toLocaleString('pt-BR')}</strong>
        </div>
      </div>
      <div className="wallet-actions">
        <button type="button" className="btn btn-sm" disabled={busy !== null || refillWait > 0} onClick={() => void claim('refill')}
          title="Recarga gratuita quando suas fichas estiverem acabando">
          {refillWait > 0 ? `Recarga em ${fmtCountdown(refillWait)}` : 'Recarga'}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy !== null || dailyWait > 0} onClick={() => void claim('daily')}
          title="Bônus de fichas grátis uma vez por dia">
          {dailyWait > 0 ? `Bônus em ${fmtCountdown(dailyWait)}` : 'Bônus diário'}
        </button>
      </div>
    </section>
  );
}
