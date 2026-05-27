/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAGE_TRANSITIONS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __googleAuthReady?: boolean
}
