// Main window creation with remembered size/position and platform-native
// title bars (inset traffic lights on macOS, overlay caption buttons elsewhere).

import { BrowserWindow, screen, shell, app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { prefs } from './preferences'
import type { WindowState } from '@shared/types'
import { resetRendererReady } from './launch'

function visibleOn(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return state.x! < a.x + a.width - 100 && state.x! + state.width > a.x + 100 && state.y! >= a.y - 20 && state.y! < a.y + a.height - 100
  })
}

export function themeColors(): { bg: string; fg: string } {
  const t = prefs.get().theme
  const dark = t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? { bg: '#141416', fg: '#e8e8ea' } : { bg: '#f6f6f7', fg: '#1b1b1f' }
}

export function createMainWindow(): BrowserWindow {
  const saved = prefs.get().window
  const { bg, fg } = themeColors()
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(visibleOn(saved) ? { x: saved.x, y: saved.y } : {}),
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: bg,
    title: 'Loupe',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 18, y: 17 } } : { titleBarOverlay: { color: bg, symbolColor: fg, height: 48 } }),
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  if (saved.maximized) win.maximize()
  if (saved.fullscreen) win.setFullScreen(true)

  win.once('ready-to-show', () => win.show())

  let saveTimer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const maximized = win.isMaximized()
      const fullscreen = win.isFullScreen()
      const b = maximized || fullscreen ? { ...prefs.get().window } : win.getBounds()
      prefs.set({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized, fullscreen } })
    }, 400)
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('enter-full-screen', () => {
    save()
    win.webContents.send('fullscreen', true)
  })
  win.on('leave-full-screen', () => {
    save()
    win.webContents.send('fullscreen', false)
  })

  // Never navigate away from the app; open web links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })
  win.webContents.on('did-start-loading', () => resetRendererReady())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
