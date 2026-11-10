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
import { TutorialTab } from './lobby/TutorialTab';
import './lobby/lobby.css';

type TabId = 'rooms' | 'ranking' | 'history' | 'help' | 'admin';

export function Lobby() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<TabId>(() => (import.meta.env.DEV && (new URLSearchParams(location.search).get('tab') as TabId)) || 'rooms');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'rooms', label: 'Salas' },
    { id: 'ranking', label: 'Ranking' },
    { id: 'history', label: 'Histórico' },
    { id: 'help', label: 'Tutorial' },
  ];
  if (me.role === 'admin') tabs.push({ id: 'admin', label: 'Admin' });

  return (
    <div className="lobby lb">
      <WalletHeader />
      <Tabs<TabId> tabs={tabs} value={tab} onChange={setTab} />
      <div className="lobby-body lb-body"><div className="lb-inner">
        {tab === 'rooms' && <RoomsTab />}
        {tab === 'ranking' && <RankingTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'help' && <TutorialTab />}
        {tab === 'admin' && me.role === 'admin' && <AdminTab />}
      </div></div>
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
      toast('success', kind === 'refill' ? 'Recarga concluída!' : 'Bônus resgatado! Volte em 1 hora para pegar outro.');
    }
  };

  const total = me.balance + me.inPlay;
  return (
    <section className="lb-wallet">
      <div className="lb-wallet-main">
        <div className="lb-wallet-hello">
          <span className="lb-avatar" aria-hidden>{me.username.slice(0, 1).toUpperCase()}</span>
          <strong title={me.username}>{me.username}</strong>
          {me.role === 'admin' && <span className="badge badge-accent">admin</span>}
        </div>
        <div className="lb-wallet-total" title={`Carteira ${me.balance.toLocaleString('pt-BR')} + na mesa ${me.inPlay.toLocaleString('pt-BR')}`}>
          <Chips amount={total} />
        </div>
        <div className="lb-wallet-sub">
          {me.inPlay > 0
            ? <>carteira {me.balance.toLocaleString('pt-BR')} · <span className="lb-inplay">na mesa {me.inPlay.toLocaleString('pt-BR')}</span></>
            : 'fichas virtuais · sem valor real'}
        </div>
      </div>
      <div className="lb-wallet-actions">
        <button type="button" className={`lb-bonus ${dailyWait > 0 ? '' : 'lb-bonus-ready'}`} disabled={busy !== null || dailyWait > 0}
          onClick={() => void claim('daily')} title="Bônus de 1.000 fichas a cada hora">
          <span className="lb-bonus-big">{dailyWait > 0 ? fmtCountdown(dailyWait) : '+1.000'}</span>
          <span className="lb-bonus-small">{dailyWait > 0 ? 'próximo bônus' : 'pegar bônus'}</span>
        </button>
        <button type="button" className="lb-refill" disabled={busy !== null || refillWait > 0} onClick={() => void claim('refill')}
          title="Recarga gratuita quando suas fichas estiverem acabando (total abaixo de 1.000)">
          {refillWait > 0 ? `Recarga em ${fmtCountdown(refillWait)}` : 'Recarga grátis'}
        </button>
      </div>
    </section>
  );
}
