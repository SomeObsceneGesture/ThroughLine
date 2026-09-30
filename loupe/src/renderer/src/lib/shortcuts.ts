import { mod, isMac } from './api'

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Library',
    items: [
      [`${mod} O`, 'Import photos & videos'],
      [`${mod} ⇧ O`, 'Import a folder'],
      [`${mod} F`, 'Search'],
      [`${mod} N`, 'New album'],
      [`${mod} A`, 'Select all'],
      [`${mod} D`, 'Deselect all'],
      [`${mod} Z`, 'Undo'],
      [isMac ? '⌘ ⇧ Z' : 'Ctrl Y', 'Redo'],
      ['Delete', 'Move to Recently Deleted'],
      ['F', 'Favorite / unfavorite'],
      ['0 – 5', 'Set rating'],
      ['T', 'Add tags'],
      ['A', 'Add to album'],
      ['R', 'Rotate clockwise'],
      [`${mod} I`, 'Show info panel'],
      [`${mod} \\`, 'Show / hide sidebar'],
      [`${mod} ⇧ R`, 'Show in folder'],
      [`${mod} , `, 'Settings']
    ]
  },
  {
    group: 'Gallery',
    items: [
      ['← → ↑ ↓', 'Move selection'],
      ['⇧ + arrows', 'Extend selection'],
      ['Space / Enter', 'Open in viewer'],
      [`${mod} + / ${mod} −`, 'Larger / smaller thumbnails'],
      [`${mod} 1 – 6`, 'Grid, Masonry, Large, Filmstrip, Timeline, List'],
      ['Esc', 'Clear selection / search']
    ]
  },
  {
    group: 'Viewer',
    items: [
      ['← →', 'Previous / next'],
      ['Space', 'Slideshow (photos) · Play / pause (videos)'],
      ['Esc', 'Close'],
      ['F', 'Favorite'],
      ['+ / −', 'Zoom in / out'],
      ['0', 'Fit to screen'],
      ['1', 'Actual size (100%)'],
      ['R', 'Rotate'],
      ['I', 'Info'],
      ['Delete', 'Move to Recently Deleted']
    ]
  },
  {
    group: 'Video',
    items: [
      ['Space / K', 'Play / pause'],
      ['J / L', 'Back / forward 10 seconds'],
      ['⇧ ← / ⇧ →', 'Back / forward 5 seconds'],
      [', / .', 'Previous / next frame'],
      ['M', 'Mute'],
      ['↑ / ↓', 'Volume'],
      ['Enter', 'Full screen']
    ]
  }
]
