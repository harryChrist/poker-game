/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

/** Id do build (vite.config.ts) — comparado com o do servidor para recarregar após deploy */
declare const __BUILD_ID__: string;
