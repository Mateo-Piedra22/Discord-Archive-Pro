// Tipos globales del renderer. La superficie de window.api se define UNA
// sola vez en src/shared/api.ts y el preload está obligado a cumplirla.
import type { AppApi } from '../shared/api'

declare global {
  interface Window {
    api: AppApi
  }

  /** Versión del producto, inyectada por Vite desde package.json. */
  const __APP_VERSION__: string
}

export {}
