import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, X, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useUI, type MenuItem } from '../../store/ui'
import { cx } from '../../lib/cx'

function MenuList({ items, x, y, altX, onDone, onBack, depth = 0 }: { items: MenuItem[]; x: number; y: number; altX?: number; onDone: () => void; onBack?: () => void; depth?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [active, setActive] = useState(-1)
  const [sub, setSub] = useState<{ index: number; x: number; y: number; altX: number } | null>(null)
  const subTimer = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight
    let nx = x, ny = y
    if (nx + w > window.innerWidth - 6) nx = altX !== undefined ? altX - w : window.innerWidth - w - 6
    if (ny + h > window.innerHeight - 6) ny = Math.max(6, window.innerHeight - h - 6)
    setPos({ x: Math.max(6, nx), y: ny })
  }, [x, y, altX])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const selectable = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0)

  const openSub = (i: number): void => {
    const row = ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)
    if (!row) return
    const r = row.getBoundingClientRect()
    setSub({ index: i, x: r.right - 2, y: r.top - 5, altX: r.left + 2 })
  }

  const activate = (i: number): void => {
    const it = items[i]
    if (!it || it.disabled || it.separator) return
    if (it.submenu) {
      openSub(i)
      return
    }
    onDone()
    it.onSelect?.()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const cur = selectable.indexOf(active)
      const next = e.key === 'ArrowDown' ? selectable[(cur + 1) % selectable.length] : selectable[(cur - 1 + selectable.length) % selectable.length]
      setActive(next ?? -1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      if (active >= 0) activate(active)
    } else if (e.key === 'ArrowRight' && active >= 0 && items[active]?.submenu) {
      e.preventDefault()
      e.stopPropagation()
      openSub(active)
    } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && depth > 0)) {
      e.preventDefault()
      e.stopPropagation()
      if (onBack) onBack()
      else onDone()
    }
  }

  return (
    <>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        onKeyDown={onKey}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed z-[180] min-w-[210px] max-w-[320px] py-1 rounded-xl bg-overlay shadow-pop anim-pop outline-none max-h-[80vh] overflow-y-auto"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((it, i) => {
          if (it.separator) return <div key={i} className="my-1 h-px bg-line mx-2" />
          const Icon = it.icon
          return (
            <div
              key={i}
              data-i={i}
              role="menuitem"
              aria-disabled={it.disabled}
              aria-haspopup={!!it.submenu}
              onMouseEnter={() => {
                setActive(i)
                if (subTimer.current) window.clearTimeout(subTimer.current)
                if (it.submenu) subTimer.current = window.setTimeout(() => openSub(i), 120)
                else subTimer.current = window.setTimeout(() => setSub(null), 150)
              }}
              onClick={() => activate(i)}
              className={cx(
                'mx-1 px-2.5 h-[28px] rounded-md flex items-center gap-2.5 text-[13px]',
                it.disabled ? 'text-fg-3' : it.danger ? 'text-danger' : 'text-fg',
                i === active && !it.disabled && (it.danger ? 'bg-danger/12' : 'bg-accent text-accent-fg')
              )}
            >
              <span className="w-4 flex items-center justify-center shrink-0">
                {it.checked ? <Check size={14} strokeWidth={2.2} /> : Icon ? <Icon size={15} strokeWidth={1.8} /> : null}
              </span>
              <span className="flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className={cx('text-[11.5px] tabular', i === active && !it.danger ? 'opacity-80' : 'text-fg-3')}>{it.shortcut}</span>}
              {it.submenu && <ChevronRight size={14} className="opacity-70" />}
            </div>
          )
        })}
      </div>
      {sub && items[sub.index]?.submenu && (
        <MenuList items={items[sub.index].submenu!} x={sub.x} y={sub.y} altX={sub.altX} depth={depth + 1} onDone={onDone} onBack={() => {
          setSub(null)
          ref.current?.focus()
        }} />
      )}
    </>
  )
}

export function ContextMenuHost() {
  const menu = useUI((s) => s.menu)
  const hide = useUI((s) => s.hideMenu)
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest('[role="menu"]')) return
      hide()
    }
    const blur = (): void => hide()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
    }
  }, [menu, hide])
  if (!menu) return null
  return createPortal(<MenuList items={menu.items} x={menu.x} y={menu.y} onDone={hide} />, document.body)
}

export function ToastHost() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return createPortal(
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[190] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? AlertCircle : t.kind === 'success' ? CheckCircle2 : Info
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto anim-up flex items-center gap-3 pl-3.5 pr-2 py-2 rounded-xl bg-[#232327] text-[#f2f2f4] shadow-[0_10px_40px_rgba(0,0,0,.35)] border border-white/8 max-w-[560px]"
          >
            <Icon size={16} className={cx('shrink-0', t.kind === 'error' ? 'text-[#ff7b7f]' : t.kind === 'success' ? 'text-[#5fd99a]' : 'text-white/60')} />
            <div className="min-w-0">
              <div className="text-[13px] leading-snug">{t.message}</div>
              {t.detail && <div className="text-[12px] text-white/55 leading-snug mt-0.5 break-words">{t.detail}</div>}
              {t.progress !== undefined && (
                <div className="h-1 mt-1.5 rounded-full bg-white/15 overflow-hidden w-56">
                  <div className="h-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${t.progress * 100}%` }} />
                </div>
              )}
            </div>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="ml-1 px-2.5 h-7 rounded-md text-[12.5px] font-semibold text-[var(--accent)] hover:bg-white/10 shrink-0"
                style={{ filter: 'brightness(1.35)' }}
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="h-7 w-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 shrink-0">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}

export function DialogHost() {
  const dialogs = useUI((s) => s.dialogs)
  const close = useUI((s) => s.closeDialog)
  return (
    <>
      {dialogs.map((d) => (
        <DialogSlot key={d.id} render={d.render} close={() => close(d.id)} />
      ))}
    </>
  )
}

function DialogSlot({ render, close }: { render: (close: () => void) => React.ReactNode; close: () => void }) {
  return <>{render(close)}</>
}
