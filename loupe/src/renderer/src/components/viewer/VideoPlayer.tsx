import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Volume2, VolumeX, Volume1, Maximize, Minimize, Repeat, Gauge, AlertTriangle, PictureInPicture2 } from 'lucide-react'
import type { Storyboard } from '@shared/types'
import { call, on } from '../../lib/api'
import { duration as fmtDur } from '../../lib/format'
import { cx } from '../../lib/cx'
import { Button, Spinner } from '../ui/controls'
import { useApp } from '../../store/app'

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

/** Chromium codec strings for canPlayType, keyed by ffprobe codec names. */
function mimeFor(codec?: string, container?: string): string | null {
  const c = (codec ?? '').toLowerCase()
  const box = (container ?? '').toLowerCase()
  if (/avi|asf|flv|mpegts|mpeg$|^mpeg,|rm|3gp.*h263/.test(box) && !box.includes('mp4')) return null
  switch (c) {
    case 'h264': return 'video/mp4; codecs="avc1.640028"'
    case 'hevc': case 'h265': return 'video/mp4; codecs="hvc1.1.6.L120.90"'
    case 'vp9': return 'video/webm; codecs="vp9"'
    case 'vp8': return 'video/webm; codecs="vp8"'
    case 'av1': return 'video/mp4; codecs="av01.0.08M.08"'
    case 'theora': return 'video/ogg; codecs="theora"'
    default: return c ? null : 'video/mp4'
  }
}

export interface VideoPlayerProps {
  id?: number
  src?: string
  active: boolean
  autoplay: boolean
  loop: boolean
  onEnded?: () => void
  onControlsVisible?: (v: boolean) => void
  poster?: string
  fps?: number
}

export function VideoPlayer({ id, src: externalSrc, active, autoplay, loop: loopDefault, onEnded, poster, fps = 30 }: VideoPlayerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(externalSrc ?? null)
  const [status, setStatus] = useState<'probing' | 'ready' | 'converting' | 'error'>(externalSrc ? 'ready' : 'probing')
  const [convertProgress, setConvertProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('loupe.volume') ?? '1'))
  const [muted, setMuted] = useState(() => localStorage.getItem('loupe.muted') === '1')
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(loopDefault)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null)
  const [speedMenu, setSpeedMenu] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const triedConvert = useRef(false)
  const storyboardRequested = useRef(false)
  const ffmpeg = useApp((s) => s.info?.ffmpeg ?? false)

  // Decide how to play: directly, or via a converted copy.
  useEffect(() => {
    if (externalSrc || id === undefined) return
    let live = true
    triedConvert.current = false
    ;(async () => {
      const probe = await call('video.probeCodec', id).catch(() => null)
      const mime = mimeFor(probe?.codec, probe?.container)
      const direct = !!mime && document.createElement('video').canPlayType(mime) !== ''
      const r = await call('video.playable', id, direct)
      if (!live) return
      if (r.status === 'direct' || r.status === 'ready') {
        setSrc(r.url!)
        setStatus('ready')
      } else if (r.status === 'converting') {
        triedConvert.current = true
        setStatus('converting')
      } else {
        setStatus('error')
        setError(r.reason ?? 'This video can’t be played.')
      }
    })()
    return () => {
      live = false
    }
  }, [id, externalSrc])

  useEffect(() => {
    if (id === undefined) return
    return on('transcode:progress', (p) => {
      if (p.id !== id) return
      if (p.done && p.url) {
        setSrc(`${p.url}?t=${Date.now()}`)
        setStatus('ready')
      } else if (p.done && p.error) {
        setStatus('error')
        setError(`The video couldn’t be converted for playback. ${p.error}`)
      } else setConvertProgress(p.progress)
    })
  }, [id])

  useEffect(() => {
    return () => {
      if (id !== undefined && status === 'converting') void call('video.cancelTranscode', id)
    }
  }, [id, status])

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = volume
    v.muted = muted
    v.playbackRate = speed
    v.loop = loop
  }, [volume, muted, speed, loop, src])

  useEffect(() => {
    if (!active) video.current?.pause()
  }, [active])

  const toggle = useCallback(() => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }, [])

  const seek = useCallback((t: number) => {
    const v = video.current
    if (!v || !isFinite(t)) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t))
    setTime(v.currentTime)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = wrap.current?.closest('[data-viewer-root]') as HTMLElement | null
    if (!document.fullscreenElement) void (el ?? wrap.current)?.requestFullscreen().catch(() => undefined)
    else void document.exitFullscreen()
  }, [])

  useEffect(() => {
    const f = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])

  // Keyboard shortcuts while this player is the active item.
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, [role="dialog"]')) return
      const v = video.current
      if (!v) return
      let handled = true
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          toggle()
          break
        case 'j':
        case 'J':
          seek(v.currentTime - 10)
          break
        case 'l':
        case 'L':
          seek(v.currentTime + 10)
          break
        case 'ArrowLeft':
          if (e.shiftKey) seek(v.currentTime - 5)
          else handled = false
          break
        case 'ArrowRight':
          if (e.shiftKey) seek(v.currentTime + 5)
          else handled = false
          break
        case ',':
          v.pause()
          seek(v.currentTime - 1 / fps)
          break
        case '.':
          v.pause()
          seek(v.currentTime + 1 / fps)
          break
        case 'm':
        case 'M':
          setMuted((m) => !m)
          break
        case 'ArrowUp':
          setVolume((x) => Math.min(1, x + 0.1))
          setMuted(false)
          break
        case 'ArrowDown':
          setVolume((x) => Math.max(0, x - 0.1))
          break
        case 'Enter':
          toggleFullscreen()
          break
        default:
          handled = false
      }
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active, toggle, seek, fps, toggleFullscreen])

  useEffect(() => {
    localStorage.setItem('loupe.volume', String(volume))
    localStorage.setItem('loupe.muted', muted ? '1' : '0')
  }, [volume, muted])

  const barTime = (clientX: number): number => {
    const r = bar.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (dur || 0)
  }

  const onBarDown = (e: React.MouseEvent): void => {
    const wasPlaying = !video.current?.paused
    video.current?.pause()
    seek(barTime(e.clientX))
    const move = (ev: MouseEvent): void => {
      seek(barTime(ev.clientX))
      const r = bar.current!.getBoundingClientRect()
      setHover({ x: ev.clientX - r.left, t: barTime(ev.clientX) })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      if (wasPlaying) void video.current?.play()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onBarHover = (e: React.MouseEvent): void => {
    const r = bar.current!.getBoundingClientRect()
    setHover({ x: e.clientX - r.left, t: barTime(e.clientX) })
    if (!storyboardRequested.current && id !== undefined && ffmpeg) {
      storyboardRequested.current = true
      void call('video.storyboard', id).then((s) => setStoryboard(s)).catch(() => undefined)
    }
  }

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-white/85 max-w-[420px] px-6">
        <AlertTriangle size={28} className="text-[#ffb347]" />
        <div className="text-[15px] font-medium">This video can’t be played</div>
        <div className="text-[13px] text-white/60 leading-relaxed">{error ?? 'The file may be damaged or use an unsupported format.'}</div>
      </div>
    )
  }

  if (status === 'converting' || status === 'probing') {
    return (
      <div className="flex flex-col items-center gap-4 text-white/85">
        {poster && <img src={poster} alt="" className="max-h-[50vh] max-w-[70vw] rounded-lg opacity-40" />}
        <div className="flex items-center gap-2.5 text-[13.5px]">
          <Spinner size={16} />
          {status === 'probing' ? 'Opening video…' : `Preparing this video for playback… ${Math.round(convertProgress * 100)}%`}
        </div>
        {status === 'converting' && (
          <>
            <div className="w-72 h-1 rounded-full bg-white/15 overflow-hidden">
              <div className="h-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${convertProgress * 100}%` }} />
            </div>
            <div className="text-[12px] text-white/50 max-w-[380px] text-center leading-relaxed">
              This format can’t be played directly, so Loupe is making a playable copy. It’s kept in the library cache so next time is instant.
            </div>
            <Button variant="ghost" size="sm" className="text-white/70! hover:bg-white/10!" onClick={() => id !== undefined && void call('video.cancelTranscode', id).then(() => { setStatus('error'); setError('Conversion cancelled.') })}>
              Cancel
            </Button>
          </>
        )}
      </div>
    )
  }

  const progress = dur ? time / dur : 0
  const sbIndex = storyboard && hover ? Math.min(storyboard.count - 1, Math.floor(hover.t / storyboard.interval)) : -1

  return (
    <div ref={wrap} className="relative w-full h-full flex items-center justify-center group/player" onDoubleClick={toggleFullscreen}>
      <video
        ref={video}
        src={src ?? undefined}
        poster={poster}
        autoPlay={autoplay && active}
        playsInline
        className="max-w-full max-h-full outline-none"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration)
          // Audio-only decode (e.g. unsupported video codec) → convert.
          if (e.currentTarget.videoWidth === 0 && id !== undefined && !triedConvert.current) {
            triedConvert.current = true
            setStatus('converting')
            void call('video.playable', id, false)
          }
        }}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onEnded={() => {
          setPlaying(false)
          onEnded?.()
        }}
        onError={() => {
          if (id !== undefined && !triedConvert.current) {
            triedConvert.current = true
            setStatus('converting')
            void call('video.playable', id, false).then((r) => {
              if (r.status === 'ready' && r.url) {
                setSrc(r.url)
                setStatus('ready')
              } else if (r.status === 'unavailable') {
                setStatus('error')
                setError(r.reason ?? null)
              }
            })
          } else {
            setStatus('error')
            setError('The file may be damaged or use a format that isn’t supported.')
          }
        }}
      />
      {waiting && playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-white/80"><Spinner size={28} /></div>
      )}
      {!playing && time === 0 && (
        <button aria-label="Play" onClick={toggle} className="absolute h-[68px] w-[68px] rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 hover:scale-105 transition-transform">
          <Play size={28} className="fill-white ml-1" />
        </button>
      )}
      {/* Controls */}
      <div
        className={cx(
          'absolute left-1/2 -translate-x-1/2 bottom-4 w-[min(860px,calc(100%-32px))] rounded-2xl bg-black/55 backdrop-blur-xl border border-white/10 px-4 pt-2.5 pb-2 text-white transition-opacity duration-200',
          playing ? 'opacity-0 group-hover/player:opacity-100 focus-within:opacity-100' : 'opacity-100'
        )}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={bar}
          className="relative h-4 flex items-center cursor-pointer group/bar"
          onMouseDown={onBarDown}
          onMouseMove={onBarHover}
          onMouseLeave={() => setHover(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
        >
          <div className="relative w-full h-[4px] group-hover/bar:h-[6px] transition-[height] rounded-full bg-white/20 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${dur ? (buffered / dur) * 100 : 0}%` }} />
            <div className="absolute inset-y-0 left-0 bg-[var(--accent)]" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="absolute h-3 w-3 rounded-full bg-white shadow -translate-x-1/2 opacity-0 group-hover/bar:opacity-100" style={{ left: `${progress * 100}%` }} />
          {hover && (
            <div className="absolute bottom-6 -translate-x-1/2 flex flex-col items-center pointer-events-none" style={{ left: Math.max(60, Math.min(hover.x, (bar.current?.clientWidth ?? 0) - 60)) }}>
              {storyboard && sbIndex >= 0 && (
                <div
                  className="rounded-md border border-white/25 shadow-lg mb-1.5 bg-black"
                  style={{
                    width: storyboard.tileWidth,
                    height: storyboard.tileHeight,
                    backgroundImage: `url(${storyboard.url})`,
                    backgroundPosition: `-${(sbIndex % storyboard.cols) * storyboard.tileWidth}px -${Math.floor(sbIndex / storyboard.cols) * storyboard.tileHeight}px`
                  }}
                />
              )}
              <div className="px-1.5 py-0.5 rounded bg-black/70 text-[11px] tabular">{fmtDur(hover.t)}</div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <button aria-label={playing ? 'Pause' : 'Play'} className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/12" onClick={toggle}>
            {playing ? <Pause size={18} className="fill-white" /> : <Play size={18} className="fill-white" />}
          </button>
          <span className="text-[12px] tabular text-white/85 ml-1 mr-2 whitespace-nowrap">
            {fmtDur(time)} <span className="text-white/45">/ {fmtDur(dur)}</span>
          </span>
          <div className="flex items-center group/vol">
            <button aria-label={muted ? 'Unmute' : 'Mute'} className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/12" onClick={() => setMuted(!muted)}>
              <VolIcon size={17} />
            </button>
            <input
              type="range"
              aria-label="Volume"
              className="slider w-0 group-hover/vol:w-20 focus:w-20 transition-[width] duration-200"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value))
                setMuted(false)
              }}
            />
          </div>
          <div className="flex-1" />
          <div className="relative">
            <button aria-label="Playback speed" className="h-8 px-2 rounded-md flex items-center gap-1 text-[12px] font-medium hover:bg-white/12 tabular" onClick={() => setSpeedMenu(!speedMenu)}>
              <Gauge size={15} /> {speed}×
            </button>
            {speedMenu && (
              <div className="absolute bottom-10 right-0 py-1 rounded-lg bg-[#1f1f23] border border-white/10 shadow-xl min-w-[88px]">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={cx('w-full h-7 px-3 text-left text-[12.5px] tabular hover:bg-white/10', s === speed && 'text-[var(--accent)] font-semibold')}
                    onClick={() => {
                      setSpeed(s)
                      setSpeedMenu(false)
                    }}
                  >
                    {s === 1 ? 'Normal' : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button aria-label="Loop" aria-pressed={loop} className={cx('h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/12', loop ? 'text-[var(--accent)]' : 'text-white/80')} onClick={() => setLoop(!loop)}>
            <Repeat size={16} />
          </button>
          {'pictureInPictureEnabled' in document && (
            <button aria-label="Picture in picture" className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/12 text-white/80" onClick={() => void video.current?.requestPictureInPicture().catch(() => undefined)}>
              <PictureInPicture2 size={16} />
            </button>
          )}
          <button aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/12" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
