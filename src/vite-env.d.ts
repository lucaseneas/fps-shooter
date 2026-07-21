/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL HTTPS do servidor Colyseus (ex.: https://fps-shooter-api.onrender.com). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
