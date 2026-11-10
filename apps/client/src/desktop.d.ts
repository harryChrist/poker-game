/** Configurações da janela gerenciadas pelo processo principal do Electron */
export interface DesktopSettings {
  alwaysOnTop: boolean;
  /** 0.3 – 1 */
  opacity: number;
  /** Atalho global (formato Electron, ex.: "CommandOrControl+Shift+Space") */
  hotkey: string;
  /** Mensagem se o atalho atual não pôde ser registrado (ex.: já em uso) */
  hotkeyError: string | null;
}

export interface DesktopApi {
  minimize(): void;
  /** Esconde na bandeja */
  hide(): void;
  quit(): void;
  getSettings(): Promise<DesktopSettings>;
  setAlwaysOnTop(value: boolean): Promise<void>;
  setOpacity(value: number): Promise<void>;
  setHotkey(accelerator: string): Promise<{ ok: boolean; error?: string }>;
  /** Retorna a função que cancela a inscrição */
  onSettingsChanged(cb: (settings: DesktopSettings) => void): () => void;
}

declare global {
  interface Window {
    /** Presente apenas dentro do Electron */
    desktop?: DesktopApi;
  }
}
