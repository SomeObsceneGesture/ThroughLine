// Native application menu. Items forward commands to the renderer, which owns
// selection and focus and therefore decides what each command applies to.

import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { emit } from './events'

const send = (cmd: string) => (): void => emit('menu', cmd)

export function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { label: 'Settings…', accelerator: 'Cmd+,', click: send('settings') },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Photos & Videos…', accelerator: 'CmdOrCtrl+O', click: send('import') },
        { label: 'Import Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: send('import-folder') },
        { type: 'separator' },
        { label: 'New Album', accelerator: 'CmdOrCtrl+N', click: send('new-album') },
        { type: 'separator' },
        { label: 'Open Library…', click: send('open-library') },
        { label: 'New Library…', click: send('new-library') },
        { label: 'Back Up Library…', click: send('backup') },
        { type: 'separator' },
        { label: 'Show in Folder', accelerator: 'CmdOrCtrl+Shift+R', click: send('show-in-folder') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { label: 'Settings', accelerator: 'Ctrl+,', click: send('settings') }, { type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('select-all') },
        { label: 'Deselect All', accelerator: 'CmdOrCtrl+D', click: send('select-none') },
        { type: 'separator' },
        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: send('find') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Grid', accelerator: 'CmdOrCtrl+1', click: send('layout:grid') },
        { label: 'Masonry', accelerator: 'CmdOrCtrl+2', click: send('layout:masonry') },
        { label: 'Large Thumbnails', accelerator: 'CmdOrCtrl+3', click: send('layout:large') },
        { label: 'Filmstrip', accelerator: 'CmdOrCtrl+4', click: send('layout:filmstrip') },
        { label: 'Timeline', accelerator: 'CmdOrCtrl+5', click: send('layout:timeline') },
        { label: 'List', accelerator: 'CmdOrCtrl+6', click: send('layout:list') },
        { type: 'separator' },
        { label: 'Larger Thumbnails', accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: 'Smaller Thumbnails', accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
        { label: 'Toggle Info Panel', accelerator: 'CmdOrCtrl+I', click: send('toggle-info') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Collage Studio', click: send('collage') },
        { label: 'Image Converter', click: send('converter') },
        { label: 'Find Duplicates', click: send('duplicates') }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: send('shortcuts') },
        { label: 'About Your Library Folder', click: send('about-library') }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
