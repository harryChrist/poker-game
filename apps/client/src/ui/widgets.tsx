import { Component, type ErrorInfo, type ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" />
      {label && <span className="muted-text">{label}</span>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><span className="empty-ico" aria-hidden>♠</span>{children}</div>;
}

interface TabDef<T extends string> { id: T; label: string }
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value}
          className={`tab ${t.id === value ? 'tab-active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <span className={`switch ${checked ? 'switch-on' : ''}`}>
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-knob" />
      </span>
    </label>
  );
}

interface BoundaryProps { children: ReactNode; resetKey?: string }
interface BoundaryState { error: Error | null }

/** Evita que um erro na tela de um jogo derrube o app inteiro */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na tela do jogo', error, info.componentStack);
  }
  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <p><strong>Não foi possível exibir esta tela do jogo.</strong></p>
        <p className="muted-text">{this.state.error.message}</p>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Tentar de novo</button>
      </div>
    );
  }
}
