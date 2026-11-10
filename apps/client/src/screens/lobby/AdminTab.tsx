import { useCallback, useEffect, useState } from 'react';
import { GAMES, type AdminUser, type RoomSummary } from '@cards/shared';
import { act } from '../../net/actions';
import { useStore } from '../../store';
import { askConfirm, askText } from '../../ui/dialogs';
import { fmtInt } from '../../ui/format';
import { IconRefresh } from '../../ui/icons';
import { Empty, Spinner, Tabs } from '../../ui/widgets';

type Sub = 'users' | 'rooms';

export function AdminTab() {
  const [sub, setSub] = useState<Sub>('users');
  return (
    <div className="stack">
      <Tabs<Sub> tabs={[{ id: 'users', label: 'Usuários' }, { id: 'rooms', label: 'Salas ativas' }]} value={sub} onChange={setSub} />
      {sub === 'users' ? <UsersPanel /> : <RoomsPanel />}
    </div>
  );
}

function UsersPanel() {
  const meId = useStore((s) => s.me?.id);
  const toast = useStore((s) => s.toast);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [amount, setAmount] = useState('1000');

  const load = useCallback(async (q: string) => {
    const res = await act('admin:users', q.trim() ? { search: q.trim() } : {});
    setUsers(res.ok ? res.data : []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const replace = (u: AdminUser) => setUsers((cur) => cur?.map((x) => (x.id === u.id ? u : x)) ?? cur);

  const adjust = async (u: AdminUser, sign: 1 | -1) => {
    const n = Math.floor(Number(amount));
    if (!Number.isFinite(n) || n <= 0) return toast('error', 'Informe um valor positivo.');
    const res = await act('admin:adjust', { userId: u.id, amount: n * sign });
    if (res.ok) {
      replace(res.data);
      toast('success', `Saldo de ${u.username} ajustado.`);
    }
  };

  const toggleBan = async (u: AdminUser) => {
    const ok = await askConfirm({
      title: u.banned ? 'Desbanir usuário' : 'Banir usuário',
      message: u.banned ? `Permitir que ${u.username} volte a entrar?` : `${u.username} será desconectado e não poderá entrar.`,
      confirmLabel: u.banned ? 'Desbanir' : 'Banir', danger: !u.banned,
    });
    if (!ok) return;
    const res = await act('admin:ban', { userId: u.id, banned: !u.banned });
    if (res.ok) replace(res.data);
  };

  const toggleRole = async (u: AdminUser) => {
    const role = u.role === 'admin' ? 'user' : 'admin';
    const ok = await askConfirm({
      title: role === 'admin' ? 'Promover a admin' : 'Rebaixar para usuário',
      message: `${u.username} ${role === 'admin' ? 'terá acesso ao painel de administração' : 'perderá o acesso ao painel de administração'}.`,
      confirmLabel: role === 'admin' ? 'Promover' : 'Rebaixar',
    });
    if (!ok) return;
    const res = await act('admin:setRole', { userId: u.id, role });
    if (res.ok) replace(res.data);
  };

  const resetPassword = async (u: AdminUser) => {
    const password = await askText({
      title: 'Resetar senha', label: `Nova senha para ${u.username}`, inputType: 'password', confirmLabel: 'Definir senha',
    });
    if (!password) return;
    const res = await act('admin:resetPassword', { userId: u.id, password });
    if (res.ok) toast('success', `Senha de ${u.username} redefinida.`);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <input className="input" placeholder="Buscar usuário…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(search)} title="Atualizar"><IconRefresh /></button>
      </div>
      {!users ? <Spinner /> : users.length === 0 ? <Empty>Nenhum usuário encontrado.</Empty> : (
        <div className="adm">
          <div className="adm-row adm-head">
            <span>Usuário</span><span className="adm-n">Saldo</span><span className="adm-n">Em jogo</span><span />
          </div>
          {users.map((u) => (
            <div key={u.id} className={`adm-row ${u.banned ? 'adm-banned' : ''}`}>
              <span className="adm-name">
                <span className={`conn-dot ${u.online ? 'dot-ok' : 'dot-off'}`} title={u.online ? 'Online' : 'Offline'} />
                <span className="adm-uname" title={u.username}>{u.username}</span>
                {u.role === 'admin' && <span className="badge badge-accent">admin</span>}
                {u.banned && <span className="badge badge-bad">banido</span>}
              </span>
              <span className="adm-n" data-label="Saldo">{fmtInt(u.balance)}</span>
              <span className="adm-n" data-label="Em jogo">{fmtInt(u.inPlay)}</span>
              <span className="adm-actions">
                <button type="button" className="btn btn-sm" onClick={() => setAdjusting(adjusting === u.id ? null : u.id)}>± Saldo</button>
                <button type="button" className="btn btn-sm" onClick={() => void toggleBan(u)} disabled={u.id === meId}>{u.banned ? 'Desbanir' : 'Banir'}</button>
                <button type="button" className="btn btn-sm" onClick={() => void toggleRole(u)} disabled={u.id === meId}>{u.role === 'admin' ? 'Rebaixar' : 'Promover'}</button>
                <button type="button" className="btn btn-sm" onClick={() => void resetPassword(u)}>Senha</button>
              </span>
              {adjusting === u.id && (
                <span className="adm-adjust">
                  <input className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void adjust(u, 1)}>+ Adicionar</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => void adjust(u, -1)}>− Remover</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomsPanel() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const load = useCallback(async () => {
    const res = await act('admin:rooms', {});
    setRooms(res.ok ? res.data : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const close = async (r: RoomSummary) => {
    const ok = await askConfirm({
      title: 'Fechar sala', message: `Fechar “${r.name}”? As fichas em jogo voltam para as carteiras.`, confirmLabel: 'Fechar sala', danger: true,
    });
    if (!ok) return;
    const res = await act('admin:closeRoom', { roomId: r.id });
    if (res.ok) void load();
  };

  if (!rooms) return <Spinner />;
  return (
    <div className="stack">
      <div className="toolbar toolbar-end">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}><IconRefresh /> Atualizar</button>
      </div>
      {rooms.length === 0 ? <Empty>Nenhuma sala ativa.</Empty> : (
        <div className="list">
          {rooms.map((r) => (
            <div key={r.id} className="room-row">
              <div className="room-row-main">
                <div className="room-row-title"><span className="room-name">{r.name}</span>{r.isPrivate && <span className="badge">privada</span>}</div>
                <div className="room-row-meta">
                  <span>{GAMES[r.gameId]?.name ?? r.gameId}</span><span>host {r.hostName}</span>
                  <span>{r.humans} humano(s) · {r.seatsTaken}/{r.seatsTotal}</span><span>{r.status}</span>
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void close(r)}>Fechar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
