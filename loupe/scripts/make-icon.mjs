// Renders the app icon (build/icon.png, 1024px) and window icon (resources/icon.png).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const sharp = require('sharp')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b8dff"/><stop offset="1" stop-color="#2743b8"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8edff"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fb4ff"/><stop offset="1" stop-color="#c9d9ff"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0b1a5c" flood-opacity="0.35"/></filter>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <g filter="url(#s)">
    <rect x="232" y="250" width="500" height="420" rx="48" fill="url(#card)" transform="rotate(-8 482 460)" opacity="0.55"/>
    <rect x="262" y="282" width="520" height="440" rx="48" fill="url(#card)"/>
    <rect x="298" y="318" width="448" height="300" rx="26" fill="url(#sky)"/>
    <path d="M298 560 L420 440 L520 530 L590 470 L746 590 L746 592 Q746 618 720 618 L324 618 Q298 618 298 592 Z" fill="#3558d6"/>
    <circle cx="660" cy="398" r="38" fill="#ffffff"/>
  </g>
  <g filter="url(#s)">
    <circle cx="640" cy="640" r="118" fill="none" stroke="#ffffff" stroke-width="44"/>
    <circle cx="640" cy="640" r="96" fill="#ffffff" fill-opacity="0.22"/>
    <path d="M722 722 L822 822" stroke="#ffffff" stroke-width="64" stroke-linecap="round"/>
  </g>
</svg>`
mkdirSync('build', { recursive: true })
mkdirSync('resources', { recursive: true })
await sharp(Buffer.from(svg)).png().toFile('build/icon.png')
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile('resources/icon.png')
console.log('icons written')
