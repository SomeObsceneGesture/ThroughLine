// The only bridge between the sandboxed renderer and the main process.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PreloadBridge } from '@shared/api'

const bridge: PreloadBridge = {
  async invoke(method, ...args) {
    const res = (await ipcRenderer.invoke('api', method, args)) as { r?: unknown; e?: string }
    if (res && 'e' in res && res.e !== undefined) throw new Error(res.e)
    return res.r as never
  },
  on(event, cb) {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload as never)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('loupe', bridge)
contextBridge.exposeInMainWorld('loupeWindow', {
  onFullscreen(cb: (v: boolean) => void) {
    const l = (_e: Electron.IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('fullscreen', l)
    return () => ipcRenderer.removeListener('fullscreen', l)
  }
})
