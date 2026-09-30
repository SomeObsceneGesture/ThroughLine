import './env'
import './sharp-preload'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { prefs } from './preferences'
import { registerSchemes, handleProtocol } from './protocol'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { createMainWindow } from './window'
import { ctx } from './context'
import { closeLibrary, openLibrary } from './library/manager'
import { pathsFromArgv, queueLaunchPaths } from './launch'
import { emit } from './events'
import sharp from 'sharp'

// sharp must be loaded on the main thread before worker threads use it.
void sharp

app.setName('Loupe')
// Isolated profile for testing or portable use.
if (process.env.LOUPE_USER_DATA) app.setPath('userData', process.env.LOUPE_USER_DATA)
prefs.load()

if (!prefs.get().hardwareAcceleration) app.disableHardwareAcceleration()

function resolveBinary(p: string | null | undefined): string | null {
  if (!p) return null
  const unpacked = p.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`)
  if (existsSync(unpacked)) return unpacked
  return existsSync(p) ? p : null
}

function locateTools(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ctx.ffmpegPath = resolveBinary(require('ffmpeg-static') as string)
  } catch {
    ctx.ffmpegPath = null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ctx.ffprobePath = resolveBinary((require('@ffprobe-installer/ffprobe') as { path: string }).path)
  } catch {
    ctx.ffprobePath = null
  }
  ctx.workerScript = join(__dirname, 'media-worker.js')
}

const argvPaths = (argv: string[]): string[] => pathsFromArgv(argv.slice(app.isPackaged ? 1 : 2))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerSchemes()
  let mainWindow: BrowserWindow | null = null

  // macOS: files dropped on the Dock icon or opened via Finder.
  app.on('open-file', (e, path) => {
    e.preventDefault()
    queueLaunchPaths([path])
    if (app.isReady() && !mainWindow) mainWindow = createMainWindow()
  })

  app.on('second-instance', (_e, argv, cwd) => {
    const paths = pathsFromArgv(argv.slice(app.isPackaged ? 1 : 2), cwd)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    queueLaunchPaths(paths)
  })

  queueLaunchPaths(argvPaths(process.argv))

  app.whenReady().then(async () => {
    locateTools()
    handleProtocol()
    registerIpc()
    buildMenu()
    nativeTheme.themeSource = prefs.get().theme
    prefs.onChange((p) => {
      if (nativeTheme.themeSource !== p.theme) nativeTheme.themeSource = p.theme
    })
    nativeTheme.on('updated', () => emit('prefs', prefs.get()))

    const last = prefs.get().lastLibrary
    if (last && existsSync(last)) {
      const r = await openLibrary(last)
      if (!r.ok) console.warn('Could not reopen last library:', r.error)
    }
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        mainWindow.on('closed', () => {
          mainWindow = null
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    prefs.flush()
    void (async () => {
      try {
        await closeLibrary()
        await ctx.pool?.destroy()
      } finally {
        app.exit(0)
      }
    })()
  })
}
