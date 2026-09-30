import { useState, type ReactNode } from 'react'
import { AlertTriangle, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { Button, Modal, TextInput } from '../ui/controls'
import { useUI } from '../../store/ui'
import { call } from '../../lib/api'

export function DialogHeader({ title, subtitle, icon }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-6 pt-6 pb-2 flex gap-4">
      {icon}
      <div className="min-w-0">
        <h2 id="dialog-title" className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
        {subtitle && <div className="mt-1.5 text-[13px] text-fg-2 leading-relaxed">{subtitle}</div>}
      </div>
    </div>
  )
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="px-6 pb-5 pt-4 flex justify-end gap-2">{children}</div>
}

export function confirmDialog(opts: {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    useUI.getState().openDialog((close) => {
      const done = (v: boolean): void => {
        close()
        resolve(v)
      }
      return (
        <Modal onClose={() => done(false)} width={440} labelledBy="dialog-title">
          <DialogHeader
            title={opts.title}
            subtitle={opts.message}
            icon={opts.danger ? <div className="h-9 w-9 shrink-0 rounded-full bg-danger/15 text-danger flex items-center justify-center"><AlertTriangle size={18} /></div> : undefined}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => done(false)}>{opts.cancelLabel ?? 'Cancel'}</Button>
            <Button className="primary-action" variant={opts.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-autofocus>
              {opts.confirmLabel ?? 'OK'}
            </Button>
          </DialogFooter>
        </Modal>
      )
    })
  })
}

function PromptBody({ opts, done }: { opts: PromptOpts; done: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    const v = value.trim()
    if (!v && !opts.allowEmpty) return
    if (opts.validate) {
      const e = await opts.validate(v)
      if (e) {
        setError(e)
        return
      }
    }
    done(v)
  }
  return (
    <Modal onClose={() => done(null)} width={420} labelledBy="dialog-title">
      <DialogHeader title={opts.title} subtitle={opts.message} />
      <div className="px-6 pt-2">
        <div className="flex items-center gap-2">
          <TextInput
            className="flex-1"
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            onFocus={(e) => {
              if (opts.selectBase) {
                const i = e.target.value.lastIndexOf('.')
                e.target.setSelectionRange(0, i > 0 ? i : e.target.value.length)
              } else e.target.select()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            data-autofocus
            aria-label={opts.title}
          />
          {opts.suffix && <span className="text-fg-3 text-[13px]">{opts.suffix}</span>}
        </div>
        {error && <div className="mt-2 text-[12.5px] text-danger">{error}</div>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => done(null)}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!value.trim() && !opts.allowEmpty}>{opts.confirmLabel ?? 'OK'}</Button>
      </DialogFooter>
    </Modal>
  )
}

interface PromptOpts {
  title: string
  message?: ReactNode
  initial?: string
  placeholder?: string
  confirmLabel?: string
  suffix?: string
  selectBase?: boolean
  allowEmpty?: boolean
  validate?: (v: string) => Promise<string | null> | string | null
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    useUI.getState().openDialog((close) => (
      <PromptBody
        opts={opts}
        done={(v) => {
          close()
          resolve(v)
        }}
      />
    ))
  })
}

/** Understandable error with optional "Show File" and technical details. */
export function errorDialog(opts: { title: string; message: ReactNode; path?: string; details?: string }): void {
  useUI.getState().openDialog((close) => <ErrorBody opts={opts} close={close} />)
}

function ErrorBody({ opts, close }: { opts: { title: string; message: ReactNode; path?: string; details?: string }; close: () => void }) {
  const [show, setShow] = useState(false)
  return (
    <Modal onClose={close} width={460} labelledBy="dialog-title">
      <DialogHeader
        title={opts.title}
        subtitle={opts.message}
        icon={<div className="h-9 w-9 shrink-0 rounded-full bg-warning/15 text-warning flex items-center justify-center"><AlertTriangle size={18} /></div>}
      />
      {opts.details && (
        <div className="px-6 pt-1">
          <button className="flex items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg" onClick={() => setShow(!show)}>
            {show ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details
          </button>
          {show && <pre className="mt-2 p-3 rounded-lg bg-input text-[11.5px] text-fg-2 whitespace-pre-wrap break-all max-h-48 overflow-auto select-text">{opts.details}</pre>}
        </div>
      )}
      <DialogFooter>
        {opts.path && (
          <Button icon={FolderOpen} variant="ghost" onClick={() => void call('app.showItemInFolder', opts.path!)}>
            Show File
          </Button>
        )}
        <Button variant="primary" onClick={close} data-autofocus>OK</Button>
      </DialogFooter>
    </Modal>
  )
}
