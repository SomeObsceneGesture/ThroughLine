import type { PreloadBridge } from '../shared/api'

declare global {
  interface Window {
    loupe: PreloadBridge
    loupeWindow: { onFullscreen(cb: (v: boolean) => void): () => void }
  }
}

export {}
