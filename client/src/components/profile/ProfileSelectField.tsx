import { useEffect, useRef, useState } from 'react'

export type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  searchable?: boolean
  allowCustomOption?: boolean
  emptyMessage?: string
}

export function ProfileSelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  loading = false,
  searchable = false,
  allowCustomOption = false,
  emptyMessage = 'No options available',
}: SelectFieldProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const mergedOptions = options.map(option => ({
    value: option.value,
    label: option.label || option.value,
  }))

  const selectedOption = mergedOptions.find(option => option.value === value)
  const buttonLabel = selectedOption?.label || value || placeholder || 'Select…'
  const filteredOptions =
    searchable && query
      ? mergedOptions.filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      : mergedOptions
  const showCreateOption =
    allowCustomOption &&
    query.trim().length > 0 &&
    !mergedOptions.some(option => option.label.toLowerCase() === query.trim().toLowerCase())

  function handleSelect(nextValue: string) {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'opacity-60' : ''}`}>
      <button
        type="button"
        className={`flex w-full items-center justify-between rounded-lg border border-c-border bg-c-bg-elevated px-3 py-1.5 text-left transition ${
          disabled ? 'cursor-not-allowed text-c-text-tertiary' : 'text-c-text-secondary hover:border-cpoint-turquoise/60'
        }`}
        onClick={() => {
          if (!disabled) setOpen(prev => !prev)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={`truncate ${value ? 'text-c-text-primary' : 'text-c-text-tertiary'}`}>{buttonLabel}</span>
        <i
          className={`fa-solid fa-chevron-down text-[10px] transition-transform ${
            open ? 'rotate-180 text-cpoint-turquoise' : 'text-c-text-tertiary'
          }`}
        />
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-c-border bg-c-bg-elevated shadow-c-glass">
          {searchable ? (
            <div className="p-2">
              <input
                className="w-full rounded-md border border-c-border bg-c-bg-surface px-2 py-1 text-xs text-c-text-secondary outline-none focus:border-cpoint-turquoise"
                placeholder="Search…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                autoFocus
              />
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-c-text-tertiary">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-c-border border-t-cpoint-turquoise" />
              Loading…
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredOptions.length ? (
                filteredOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-2 text-xs text-c-text-secondary transition hover:bg-c-hover-bg ${
                      option.value === value ? 'text-cpoint-turquoise' : ''
                    }`}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value ? <i className="fa-solid fa-check text-[10px]" /> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-c-text-tertiary">{emptyMessage}</div>
              )}
              {showCreateOption ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
                  onClick={() => handleSelect(query.trim())}
                >
                  <i className="fa-solid fa-plus text-[10px]" />
                  Add "{query.trim()}"
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
