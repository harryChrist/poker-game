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

type TabId = 'rooms' | 'ranking' | 'history' | 'help' | 'admin';

export function Lobby() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<TabId>('rooms');
  const tabs: { id: TabId; label: string }[] = [
    { id: 'rooms', label: 'Salas' },
    { id: 'ranking', label: 'Ranking' },
    { id: 'history', label: 'Histórico' },
    { id: 'help', label: 'Tutorial' },
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
        {tab === 'help' && <TutorialTab />}
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
      toast('success', kind === 'refill' ? 'Recarga concluída!' : 'Bônus resgatado! Volte em 1 hora para pegar outro.');
    }
  };

  const total = me.balance + me.inPlay;
  return (
    <section className="hero">
      <div className="hero-left">
        <div className="hero-hello">
          Olá, <strong title={me.username}>{me.username}</strong>
          {me.role === 'admin' && <span className="badge badge-accent">admin</span>}
        </div>
        <div className="hero-total" title={`Carteira ${me.balance.toLocaleString('pt-BR')} + na mesa ${me.inPlay.toLocaleString('pt-BR')}`}>
          <Chips amount={total} />
        </div>
        <div className="hero-sub">
          {me.inPlay > 0
            ? <>carteira {me.balance.toLocaleString('pt-BR')} · <span className="hero-inplay">na mesa {me.inPlay.toLocaleString('pt-BR')}</span></>
            : 'fichas virtuais · não é dinheiro de verdade'}
        </div>
      </div>
      <div className="hero-actions">
        <button type="button" className={`hero-bonus ${dailyWait > 0 ? '' : 'hero-bonus-ready'}`} disabled={busy !== null || dailyWait > 0}
          onClick={() => void claim('daily')} title="Bônus de 1.000 fichas a cada hora">
          <span className="hero-bonus-big">{dailyWait > 0 ? fmtCountdown(dailyWait) : '+1.000'}</span>
          <span className="hero-bonus-small">{dailyWait > 0 ? 'próximo bônus' : 'pegar bônus'}</span>
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy !== null || refillWait > 0} onClick={() => void claim('refill')}
          title="Recarga gratuita quando suas fichas estiverem acabando (total abaixo de 1.000)">
          {refillWait > 0 ? `Recarga em ${fmtCountdown(refillWait)}` : 'Recarga'}
        </button>
      </div>
    </section>
  );
}
