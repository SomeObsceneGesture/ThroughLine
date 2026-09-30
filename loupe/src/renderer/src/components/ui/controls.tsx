import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; size?: 'sm' | 'md' | 'lg' }>(
  function Button({ variant = 'secondary', icon: Icon, size = 'md', className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        {...rest}
        className={cx(
          'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background,color,box-shadow,opacity] duration-150 select-none disabled:opacity-45 disabled:pointer-events-none',
          size === 'sm' && 'h-7 px-2.5 text-[12px]',
          size === 'md' && 'h-8 px-3 text-[13px]',
          size === 'lg' && 'h-10 px-4 text-[14px]',
          variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgba(0,0,0,.2)]',
          variant === 'secondary' && 'bg-hover text-fg hover:bg-active border border-line',
          variant === 'ghost' && 'text-fg-2 hover:text-fg hover:bg-hover',
          variant === 'subtle' && 'text-accent hover:bg-accent-soft',
          variant === 'danger' && 'bg-danger text-white hover:brightness-110',
          className
        )}
      >
        {Icon && <Icon size={size === 'sm' ? 14 : 15} strokeWidth={1.9} className="shrink-0" />}
        {children}
      </button>
    )
  }
)

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: number; tone?: 'default' | 'onDark' }>(
  function IconButton({ icon: Icon, label, active, size = 16, className, tone = 'default', ...rest }, ref) {
    return (
      <Tooltip label={label}>
        <button
          ref={ref}
          aria-label={label}
          aria-pressed={active}
          {...rest}
          className={cx(
            'inline-flex items-center justify-center rounded-md h-8 w-8 shrink-0 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none',
            tone === 'default' && (active ? 'bg-active text-fg' : 'text-fg-2 hover:text-fg hover:bg-hover'),
            tone === 'onDark' && (active ? 'bg-white/20 text-white' : 'text-white/80 hover:text-white hover:bg-white/12'),
            className
          )}
        >
          <Icon size={size} strokeWidth={1.8} />
        </button>
      </Tooltip>
    )
  }
)

// ─── Tooltip ────────────────────────────────────────────────────────────────

export function Tooltip({ label, children, side = 'bottom', delay = 450 }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'right' | 'left'; delay?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const show = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = wrap.current?.firstElementChild as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      if (side === 'bottom') setPos({ x: r.left + r.width / 2, y: r.bottom + 6 })
      else if (side === 'top') setPos({ x: r.left + r.width / 2, y: r.top - 6 })
      else if (side === 'right') setPos({ x: r.right + 8, y: r.top + r.height / 2 })
      else setPos({ x: r.left - 8, y: r.top + r.height / 2 })
    }, delay)
  }
  const hide = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setPos(null)
  }
  useEffect(() => () => hide(), [])
  return (
    <span ref={wrap} className="contents" onMouseEnter={show} onMouseLeave={hide} onMouseDown={hide}>
      {children}
      {pos &&
        label &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md text-[11.5px] font-medium bg-[#26262b] text-[#f1f1f3] shadow-lg anim-fade whitespace-nowrap"
            style={{
              left: pos.x,
              top: pos.y,
              transform:
                side === 'bottom' ? 'translateX(-50%)' : side === 'top' ? 'translate(-50%, -100%)' : side === 'right' ? 'translateY(-50%)' : 'translate(-100%, -50%)'
            }}
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  )
}

// ─── Slider ─────────────────────────────────────────────────────────────────

export function Slider({ value, min, max, step = 1, onChange, className, label, ...rest }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; className?: string; label?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      aria-label={label}
      className={cx('slider', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ['--fill' as string]: `${fill}%` }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      {...rest}
    />
  )
}

// ─── Segmented control ──────────────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, size = 'md', className }: { value: T; options: { value: T; label?: string; icon?: LucideIcon; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div role="radiogroup" className={cx('inline-flex p-0.5 rounded-lg bg-input border border-line gap-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        const btn = (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            aria-label={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150 flex-1 whitespace-nowrap',
              size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
              active ? 'bg-raised text-fg shadow-[0_1px_2px_rgba(0,0,0,.18),0_0_0_0.5px_var(--line-strong)]' : 'text-fg-2 hover:text-fg'
            )}
          >
            {Icon && <Icon size={14} strokeWidth={1.8} />}
            {o.label}
          </button>
        )
        return o.title && !o.label ? (
          <Tooltip key={o.value} label={o.title}>
            {btn}
          </Tooltip>
        ) : (
          btn
        )
      })}
    </div>
  )
}

// ─── Switch ─────────────────────────────────────────────────────────────────

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-line-strong'
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-200 ease-out-soft',
          checked && 'translate-x-[14px]'
        )}
      />
    </button>
  )
}

export function Checkbox({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-default select-none">
      <button
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'h-4 w-4 rounded-[4px] border flex items-center justify-center transition-colors',
          checked || indeterminate ? 'bg-accent border-accent text-white' : 'border-line-strong bg-input'
        )}
      >
        {checked && <Check size={12} strokeWidth={3} />}
        {!checked && indeterminate && <span className="w-2 h-0.5 bg-white rounded" />}
      </button>
      {label && <span className="text-[13px]">{label}</span>}
    </label>
  )
}

// ─── Select ─────────────────────────────────────────────────────────────────

export function Select<T extends string | number>({ value, options, onChange, className, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; label?: string }) {
  return (
    <div className={cx('relative inline-flex', className)}>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value)
          if (o) onChange(o.value)
        }}
        className="appearance-none h-8 pl-3 pr-8 rounded-md bg-input border border-line text-[13px] text-fg w-full hover:border-line-strong focus-visible:border-accent"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-fg-3" />
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon }>(function TextInput({ className, icon: Icon, ...rest }, ref) {
  return (
    <div className={cx('relative flex items-center', className)}>
      {Icon && <Icon size={15} strokeWidth={1.8} className="absolute left-2.5 text-fg-3 pointer-events-none" />}
      <input
        ref={ref}
        spellCheck={false}
        {...rest}
        className={cx(
          'h-8 w-full rounded-md bg-input border border-line text-[13px] text-fg placeholder:text-fg-3 transition-[border,box-shadow] duration-150 focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)]',
          Icon ? 'pl-8 pr-3' : 'px-3'
        )}
      />
    </div>
  )
})

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-[5px] border border-line-strong bg-input text-[11px] font-medium text-fg-2 font-sans">{children}</kbd>
}

// ─── Popover ────────────────────────────────────────────────────────────────

export function Popover({ anchor, open, onClose, children, align = 'end', width, className }: { anchor: HTMLElement | null; open: boolean; onClose: () => void; children: ReactNode; align?: 'start' | 'end' | 'center'; width?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !anchor) return
    const r = anchor.getBoundingClientRect()
    const w = width ?? ref.current?.offsetWidth ?? 280
    let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    setPos({ top: r.bottom + 6, left })
  }, [open, anchor, align, width])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, anchor, onClose])
  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={cx('fixed z-[120] rounded-xl bg-overlay shadow-pop anim-pop no-drag', className)}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: `calc(100vh - ${(pos?.top ?? 0) + 16}px)`, overflow: 'auto' }}
    >
      {children}
    </div>,
    document.body
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

export function Modal({ onClose, children, width = 460, className, dismissable = true, labelledBy }: { onClose: () => void; children: ReactNode; width?: number; className?: string; dismissable?: boolean; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button.primary-action')
    ;(first ?? ref.current)?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const a = f[0], b = f[f.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          b.focus()
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      prev?.focus?.()
    }
  }, [onClose, dismissable])
  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 anim-fade no-drag"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx('bg-raised rounded-2xl shadow-pop anim-pop max-h-[88vh] flex flex-col', className)}
        style={{ width }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx('animate-spin', className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx('h-1 rounded-full bg-line-strong overflow-hidden', className)}>
      <div className="h-full bg-accent rounded-full transition-[width] duration-300 ease-out-soft" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}
