import { useTranslation } from 'react-i18next'

export type SteveDebugTrace = {
  planner?: Record<string, unknown>
  retrieval?: Record<string, unknown>
  fusion?: Record<string, unknown>
  context?: Record<string, unknown>
  final_answer?: Record<string, unknown>
}

export const DEBUG_TABS = [
  { key: 'planner', labelKey: 'networking.debug.tab_planner' },
  { key: 'retrieval', labelKey: 'networking.debug.tab_retrieval' },
  { key: 'fusion', labelKey: 'networking.debug.tab_fusion' },
  { key: 'context', labelKey: 'networking.debug.tab_context' },
  { key: 'final_answer', labelKey: 'networking.debug.tab_final' },
] as const
export type DebugTabKey = (typeof DEBUG_TABS)[number]['key']

function DebugJsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap rounded-xl border border-c-border bg-c-bg-app/70 p-3 text-[11px] leading-relaxed text-c-text-secondary">
      {JSON.stringify(data ?? {}, null, 2)}
    </pre>
  )
}

/** Admin-only sanitized pipeline trace viewer (staging debug toggle). */
export default function SteveDebugModal({
  trace,
  activeTab,
  onTabChange,
  onClose,
}: {
  trace: SteveDebugTrace
  activeTab: DebugTabKey
  onTabChange: (tab: DebugTabKey) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-[80] bg-c-bg-overlay backdrop-blur-sm px-3 py-6" role="dialog" aria-modal="true" aria-label={t('networking.debug.modal_aria')}>
      <div className="mx-auto flex max-h-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cpoint-turquoise/25 bg-c-bg-elevated shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-c-border p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cpoint-turquoise">{t('networking.debug.staging_label')}</p>
            <h2 className="mt-1 text-lg font-semibold text-c-text-primary">{t('networking.debug.title')}</h2>
            <p className="mt-1 text-xs text-c-text-tertiary">{t('networking.debug.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-c-border px-3 py-1.5 text-xs text-c-text-secondary hover:border-c-border-strong"
          >
            {t('networking.debug.close')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-c-border p-3">
          {DEBUG_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${activeTab === tab.key ? 'border-cpoint-turquoise/60 bg-cpoint-turquoise/10 text-cpoint-turquoise' : 'border-c-border text-c-text-secondary hover:border-c-border-strong'}`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <div className="overflow-auto p-4">
          <DebugJsonBlock data={trace[activeTab]} />
        </div>
      </div>
    </div>
  )
}
