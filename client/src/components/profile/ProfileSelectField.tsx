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
        className={`flex w-full items-center justify-between rounded-lg border border-white/12 bg-[#10131a] px-3 py-1.5 text-left transition ${
          disabled ? 'cursor-not-allowed text-white/40' : 'text-white/80 hover:border-[#4db6ac]/60'
        }`}
        onClick={() => {
          if (!disabled) setOpen(prev => !prev)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        <span className={`truncate ${value ? 'text-white' : 'text-white/40'}`}>{buttonLabel}</span>
        <i
          className={`fa-solid fa-chevron-down text-[10px] transition-transform ${
            open ? 'rotate-180 text-[#4db6ac]' : 'text-white/50'
          }`}
        />
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-lg border border-white/12 bg-[#0b0d11] shadow-[0_16px_35px_rgba(2,4,8,0.55)]">
          {searchable ? (
            <div className="p-2">
              <input
                className="w-full rounded-md border border-white/10 bg-[#12141a] px-2 py-1 text-xs text-white/80 outline-none focus:border-[#4db6ac]"
                placeholder="Search…"
                value={query}
                onChange={event => setQuery(event.target.value)}
                autoFocus
              />
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-white/60">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-[#4db6ac]" />
              Loading…
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto py-1">
              {filteredOptions.length ? (
                filteredOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-2 text-xs text-white/80 transition hover:bg-white/10 ${
                      option.value === value ? 'text-[#4db6ac]' : ''
                    }`}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value ? <i className="fa-solid fa-check text-[10px]" /> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-white/40">{emptyMessage}</div>
              )}
              {showCreateOption ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-[#4db6ac] transition hover:bg-[#4db6ac]/10"
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
