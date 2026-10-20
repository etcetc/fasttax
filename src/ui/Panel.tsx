import { useEffect, useId, useState, type ReactNode } from 'react'

const storageKey = (id: string) => `fasttax.panel.${id}`

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(storageKey(id))
    return v === null ? fallback : v === '1'
  } catch { return fallback }
}

/** A section that shows one headline line and expands to its detail. Remembers open/closed per browser. */
export function Panel(props: {
  id: string
  title: string
  headline?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(props.id, props.defaultOpen ?? false))
  const bodyId = useId()

  useEffect(() => {
    try { localStorage.setItem(storageKey(props.id), open ? '1' : '0') } catch { /* ignore */ }
  }, [props.id, open])

  return (
    <section className="rounded-lg border border-rule bg-sheet">
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-baseline justify-between gap-4 px-4 py-3.5 text-left sm:px-5"
        >
          <span className="text-[16px] font-semibold">
            <span className="mr-2 inline-block w-3 text-ink-soft" aria-hidden>{open ? '−' : '+'}</span>
            {props.title}
          </span>
          {props.headline !== undefined && <span className="text-right text-[16px]">{props.headline}</span>}
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="border-t border-rule px-4 pb-4 sm:px-5">
          {props.children}
        </div>
      )}
    </section>
  )
}
