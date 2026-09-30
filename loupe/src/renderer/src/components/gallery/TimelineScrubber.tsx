import { useEffect, useState } from 'react'
import { cx } from '../../lib/cx'

/** Year index on the right edge of the timeline for fast jumping. */
export function TimelineScrubber({ markers, scroller, total }: { markers: { year: number; y: number }[]; scroller: React.RefObject<HTMLDivElement | null>; total: number }) {
  const [current, setCurrent] = useState<number | null>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = (): void => {
      const y = el.scrollTop + 60
      let cur: number | null = null
      for (const m of markers) if (m.y <= y) cur = m.year
      setCurrent(cur ?? markers[0]?.year ?? null)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [markers, scroller])
  if (markers.length < 2) return null
  return (
    <nav aria-label="Jump to year" className="w-14 shrink-0 py-4 flex flex-col items-center gap-0.5 overflow-y-auto scroll border-l border-line">
      {markers.map((m) => (
        <button
          key={m.year}
          onClick={() => scroller.current?.scrollTo({ top: m.y - 8, behavior: 'smooth' })}
          className={cx(
            'w-11 h-6 rounded-md text-[11.5px] tabular font-medium transition-colors',
            current === m.year ? 'bg-accent text-accent-fg' : 'text-fg-3 hover:text-fg hover:bg-hover'
          )}
          title={`Jump to ${m.year}`}
        >
          {m.year}
        </button>
      ))}
      <div className="sr-only">{total}</div>
    </nav>
  )
}
