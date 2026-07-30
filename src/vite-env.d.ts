/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL HTTPS do servidor Colyseus (ex.: https://fps-shooter-api.onrender.com). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Keyboard Lock API (Chromium) — captura atalhos reservados do browser. */
interface Keyboard {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

interface Navigator {
  readonly keyboard?: Keyboard;
}
