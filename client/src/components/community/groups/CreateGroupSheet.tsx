import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHAT_KEYBOARD_ANIMATION_MS, CPOINT_EASE_OUT } from '../../../design/motion'
import type { CommunityNode } from './types'

type TreeRow = { id: number; name: string; depth: number }

function flattenTree(node: CommunityNode | undefined): TreeRow[] {
  if (!node) return []
  const rows: TreeRow[] = []
  function walk(n: CommunityNode, depth: number) {
    rows.push({ id: n.id, name: n.name, depth })
    for (const child of n.children || []) walk(child, depth + 1)
  }
  walk(node, 0)
  return rows
}

function pathTo(node: CommunityNode | undefined, id: number): string[] {
  function walk(n: CommunityNode | undefined, trail: string[]): string[] | null {
    if (!n) return null
    const next = [...trail, n.name]
    if (n.id === id) return next
    for (const child of n.children || []) {
      const found = walk(child, next)
      if (found) return found
    }
    return null
  }
  return walk(node, []) || []
}

/** Localized starter-name chips — plain suggestions, no AI spend. */
const SUGGESTION_KEYS = [
  'communities.group_suggestion_announcements',
  'communities.group_suggestion_events',
  'communities.group_suggestion_qa',
  'communities.group_suggestion_social',
  'communities.group_suggestion_projects',
] as const

/**
 * Create-group flow: a full-tree location picker (any depth — creating in
 * PNT from the TAP root works), the resolved path spelled out, a segmented
 * join policy, and the Steve agent toggle with a working add-on door when
 * the network lacks the package. Creation ends inside the new group.
 */
export default function CreateGroupSheet({
  open,
  onClose,
  tree,
  defaultTargetId,
  keyboardInset,
  steveAllowed,
  steveAddonUrl,
  onCreated,
  onToast,
}: {
  open: boolean
  onClose: () => void
  tree: CommunityNode | undefined
  defaultTargetId: number
  keyboardInset: number
  steveAllowed: (communityId: number) => boolean
  steveAddonUrl: (communityId: number) => string
  onCreated: (groupId: number) => void
  onToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const [targetId, setTargetId] = useState<number>(defaultTargetId)
  const [name, setName] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [steveEnabled, setSteveEnabled] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setTargetId(defaultTargetId)
      setName('')
      setApprovalRequired(false)
      setSteveEnabled(false)
      setPickerOpen(false)
    }
  }, [open, defaultTargetId])

  const rows = useMemo(() => flattenTree(tree), [tree])
  const target = rows.find(r => r.id === targetId) || rows[0]
  const path = useMemo(() => pathTo(tree, targetId), [tree, targetId])
  const canSteve = steveAllowed(targetId)

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) { onToast(t('communities.group_name_required')); return }
    setCreating(true)
    try {
      const fd = new URLSearchParams({
        community_id: String(targetId),
        name: name.trim(),
        approval_required: approvalRequired ? '1' : '0',
      })
      if (steveEnabled && canSteve) {
        fd.append('steve_agent_enabled', '1')
        fd.append('steve_agent_preset', 'career_expert')
      }
      const r = await fetch('/api/groups/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd,
      })
      const j = await r.json().catch(() => null)
      if (j?.success && j.group_id) onCreated(Number(j.group_id))
      else onToast(j?.error || t('communities.failed_create_group'))
    } catch {
      onToast(t('communities.network_error'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-c-bg-overlay backdrop-blur flex items-center justify-center p-4"
      style={{
        paddingBottom: keyboardInset ? keyboardInset + 16 : undefined,
        transition: `padding-bottom ${CHAT_KEYBOARD_ANIMATION_MS}ms ${CPOINT_EASE_OUT}`,
      }}
      onClick={e => { if (e.currentTarget === e.target) onClose() }}
    >
      <div className="w-full max-w-sm max-h-full overflow-y-auto overscroll-contain rounded-2xl border border-c-border bg-c-bg-elevated text-c-text-primary p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm">{t('communities.create_group')}</div>
          <button className="p-2 rounded-md text-c-text-secondary hover:bg-c-hover-bg" onClick={onClose} aria-label={t('common.close')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="space-y-3">
          {/* Location — full recursive tree */}
          <div>
            <label className="block text-xs text-c-text-tertiary mb-1">{t('communities.group_location_label')}</label>
            <button
              type="button"
              className="w-full px-3 py-2 rounded-md bg-c-bg-app border border-c-border text-sm text-c-text-primary text-left flex items-center justify-between gap-2"
              onClick={() => setPickerOpen(v => !v)}
              aria-expanded={pickerOpen}
            >
              <span className="truncate">{target?.name || ''}</span>
              <i className={`fa-solid fa-chevron-${pickerOpen ? 'up' : 'down'} text-xs text-c-text-tertiary`} aria-hidden />
            </button>
            {pickerOpen && (
              <div className="mt-1 rounded-md border border-c-border bg-c-bg-app max-h-52 overflow-y-auto" role="listbox">
                {rows.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    role="option"
                    aria-selected={row.id === targetId}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
                      row.id === targetId ? 'text-cpoint-turquoise bg-cpoint-turquoise/10' : 'text-c-text-primary hover:bg-c-hover-bg'
                    }`}
                    style={{ paddingLeft: `${12 + row.depth * 16}px` }}
                    onClick={() => { setTargetId(row.id); setPickerOpen(false) }}
                  >
                    {row.depth > 0 && (
                      <span className="w-1 h-1 rounded-full bg-c-text-disabled shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{row.name}</span>
                  </button>
                ))}
              </div>
            )}
            {path.length > 1 && (
              <div className="text-[11px] text-c-text-tertiary mt-1">
                {t('communities.group_will_live_in', { path: path.join(' › ') })}
              </div>
            )}
          </div>

          {/* Name + suggestion chips */}
          <div>
            <label className="block text-xs text-c-text-tertiary mb-1">{t('communities.group_name')}</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('communities.group_name_placeholder')}
              className="w-full px-3 py-2 rounded-md bg-c-bg-app border border-c-border text-sm text-c-text-primary placeholder:text-c-text-disabled"
            />
            {!name.trim() && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SUGGESTION_KEYS.map(key => (
                  <button
                    key={key}
                    type="button"
                    className="px-2.5 h-7 rounded-full bg-c-hover-bg text-[11px] text-c-text-secondary hover:text-c-text-primary"
                    onClick={() => setName(t(key))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Join policy — segmented, not a dropdown */}
          <div>
            <label className="block text-xs text-c-text-tertiary mb-1">{t('communities.join_policy')}</label>
            <div className="inline-flex p-0.5 rounded-full bg-c-bg-app border border-c-border" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={!approvalRequired}
                className={`px-3.5 h-9 rounded-full text-xs font-medium ${!approvalRequired ? 'bg-cpoint-turquoise/15 text-cpoint-turquoise' : 'text-c-text-tertiary hover:text-c-text-secondary'}`}
                onClick={() => setApprovalRequired(false)}
              >
                {t('communities.join_policy_open')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={approvalRequired}
                className={`px-3.5 h-9 rounded-full text-xs font-medium ${approvalRequired ? 'bg-cpoint-turquoise/15 text-cpoint-turquoise' : 'text-c-text-tertiary hover:text-c-text-secondary'}`}
                onClick={() => setApprovalRequired(true)}
              >
                {t('communities.join_policy_approval_required')}
              </button>
            </div>
            <div className="text-[11px] text-c-text-tertiary mt-1">
              {approvalRequired ? t('communities.join_policy_approval_hint') : t('communities.join_policy_open_hint')}
            </div>
          </div>

          {/* Steve agent */}
          <div>
            <label className="flex items-start gap-2 text-sm text-c-text-primary cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                disabled={!canSteve}
                checked={steveEnabled && canSteve}
                onChange={e => setSteveEnabled(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t('communities.steve_agent_label')}</span>
                <span className="block text-xs text-c-text-tertiary mt-0.5">{t('communities.steve_agent_desc')}</span>
              </span>
            </label>
            {!canSteve && (
              <a
                href={steveAddonUrl(targetId)}
                className="inline-flex items-center gap-1.5 mt-2 h-8 px-3 rounded-lg border border-cpoint-turquoise/40 text-cpoint-turquoise text-xs font-medium hover:bg-cpoint-turquoise/10"
              >
                {t('communities.add_steve_addon')}
              </a>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              className="px-3 py-2 rounded-md border border-c-border bg-c-bg-surface text-sm text-c-text-secondary hover:bg-c-hover-bg"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              disabled={creating}
              className="px-3 py-2 rounded-md bg-cpoint-turquoise text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
              onClick={submit}
            >
              {creating ? <i className="fa-solid fa-spinner fa-spin" aria-hidden /> : t('communities.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
