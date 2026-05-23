type SettingsSwitchProps = {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

export default function SettingsSwitch({ checked, disabled, onChange, label, description }: SettingsSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-white">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-white/45">{description}</span> : null}
      </span>
      <span
        className={`relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          checked ? 'bg-[#4db6ac]' : 'bg-white/14'
        }`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-lg transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            checked ? 'translate-x-[1.45rem]' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}
