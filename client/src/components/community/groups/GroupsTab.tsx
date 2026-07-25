import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCommunityGroups } from '../../../hooks/useCommunityGroups'
import type { CommunityGroup, CommunityNode } from './types'
import GroupCard from './GroupCard'
import GroupScopeBreadcrumb from './GroupScopeBreadcrumb'
import GroupScopeToggle from './GroupScopeToggle'
import GroupListSkeleton from './GroupListSkeleton'
import GroupsEmptyState from './GroupsEmptyState'
import ConfirmSheet from './ConfirmSheet'

const SEARCH_THRESHOLD = 15

function walkTreeIds(node: CommunityNode | undefined): number[] {
  if (!node) return []
  const out: number[] = []
  const stack: CommunityNode[] = [node]
  while (stack.length) {
    const cur = stack.shift()!
    out.push(cur.id)
    if (cur.children?.length) stack.unshift(...cur.children)
  }
  return out
}

function chainTo(fullTree: CommunityNode[], id: number): CommunityNode[] {
  function walk(nodes: CommunityNode[] | undefined, trail: CommunityNode[]): CommunityNode[] | null {
    for (const n of nodes || []) {
      const next = [...trail, n]
      if (n.id === id) return next
      const found = walk(n.children, next)
      if (found) return found
    }
    return null
  }
  return walk(fullTree, []) || []
}

function lastSeenKey(groupId: number): string {
  return `group_last_seen:${groupId}`
}

function hasNewActivity(group: CommunityGroup): boolean {
  if (!group.last_activity_at || group.status !== 'member') return false
  try {
    const seenRaw = window.localStorage.getItem(lastSeenKey(group.group_id))
    const activityTs = Date.parse(String(group.last_activity_at).replace(' ', 'T'))
    if (!Number.isFinite(activityTs)) return false
    if (!seenRaw) return false // never opened on this device — no alarm, just the card
    return activityTs > Number(seenRaw)
  } catch {
    return false
  }
}

/**
 * The rebuilt Groups tab: one scoped, tree-aware directory. Breadcrumb for
 * "where am I", a two-option scope toggle instead of dropdown filters, one
 * merged card list grouped by owning community when the scope includes
 * sub-communities.
 */
export default function GroupsTab({
  scopeNode,
  fullTree,
  active,
  currentUsername,
  isAppAdmin,
  highlightGroupId,
  onCreate,
  onNavigateCommunity,
  onOpenGroup,
  onManageGroup,
  onToast,
}: {
  scopeNode?: CommunityNode
  fullTree: CommunityNode[]
  active: boolean
  currentUsername: string | null
  isAppAdmin: boolean
  highlightGroupId: number | null
  onCreate: () => void
  onNavigateCommunity: (communityId: number) => void
  onOpenGroup: (groupId: number) => void
  onManageGroup: (groupId: number) => void
  onToast: (message: string) => void
}) {
  const { t } = useTranslation()
  const [includeSubs, setIncludeSubs] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ kind: 'leave' | 'delete'; group: CommunityGroup } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const subtreeIds = useMemo(() => walkTreeIds(scopeNode), [scopeNode])
  const hasSubs = subtreeIds.length > 1
  const scopeIds = useMemo<Set<number> | null>(() => {
    if (!scopeNode) return null
    return new Set(includeSubs ? subtreeIds : [scopeNode.id])
  }, [scopeNode, includeSubs, subtreeIds])
  const subtreeIdSet = useMemo(() => new Set(subtreeIds), [subtreeIds])

  const { groups, allGroups, loading, loadedOnce, reload, join, joiningGroupId, leave, remove } = useCommunityGroups(scopeIds, active)

  const chain = useMemo(
    () => (scopeNode ? chainTo(fullTree, scopeNode.id) : []),
    [fullTree, scopeNode],
  )

  // Can the viewer create/manage here? Owner of any ancestor (root owners
  // rule their whole tree) or app admin. Community admins pass server-side;
  // the client affordance keys off ownership.
  const me = (currentUsername || '').trim().toLowerCase()
  const ownsScope = useMemo(() => {
    if (isAppAdmin) return true
    if (!me) return false
    const nodes = chain.length ? chain : scopeNode ? [scopeNode] : []
    return nodes.some(n => (n.creator_username || '').trim().toLowerCase() === me)
  }, [isAppAdmin, me, chain, scopeNode])

  const canManageGroup = (group: CommunityGroup): boolean => {
    if (isAppAdmin || ownsScope) return true
    return !!me && (group.created_by || '').trim().toLowerCase() === me
  }

  const searchActive = groups.length > SEARCH_THRESHOLD
  const visibleGroups = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return groups
    return groups.filter(g => g.name.toLowerCase().includes(term))
  }, [groups, search])

  // Grouped by owning community (tree order) when the scope spans subs.
  const sections = useMemo(() => {
    if (!scopeNode || !includeSubs) return [{ id: scopeNode?.id ?? 0, name: '', groups: visibleGroups }]
    const byCommunity = new Map<number, CommunityGroup[]>()
    for (const g of visibleGroups) {
      const list = byCommunity.get(g.community_id) || []
      list.push(g)
      byCommunity.set(g.community_id, list)
    }
    return subtreeIds
      .filter(id => byCommunity.has(id))
      .map(id => ({
        id,
        name: visibleGroups.find(g => g.community_id === id)?.community_name || '',
        groups: byCommunity.get(id)!,
      }))
  }, [scopeNode, includeSubs, visibleGroups, subtreeIds])

  // Empty-state variant: does the wider subtree hold groups this scope hides?
  const elsewhereCount = useMemo(() => {
    if (!scopeNode || includeSubs) return 0
    return allGroups.filter(
      g => subtreeIdSet.has(g.community_id) && g.community_id !== scopeNode.id,
    ).length
  }, [scopeNode, includeSubs, allGroups, subtreeIdSet])

  const runConfirm = async () => {
    if (!confirmAction) return
    setConfirmBusy(true)
    const ok = confirmAction.kind === 'leave'
      ? await leave(confirmAction.group.group_id)
      : await remove(confirmAction.group.group_id)
    setConfirmBusy(false)
    setConfirmAction(null)
    if (ok) onToast(confirmAction.kind === 'leave' ? t('communities.group_left_toast') : t('communities.group_deleted_toast'))
    else onToast(confirmAction.kind === 'leave' ? t('communities.failed_leave_group') : t('communities.failed_delete_group'))
  }

  const showSkeleton = loading && !loadedOnce

  return (
    <div className="space-y-3">
      {chain.length > 1 && (
        <GroupScopeBreadcrumb chain={chain} onNavigate={onNavigateCommunity} />
      )}
      {scopeNode && hasSubs && (
        <GroupScopeToggle
          includeSubs={includeSubs}
          onChange={setIncludeSubs}
          communityName={scopeNode.name}
        />
      )}
      {searchActive && (
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('communities.group_search_placeholder')}
          className="w-full px-3 py-2 rounded-xl bg-c-bg-app border border-c-border text-sm text-c-text-primary placeholder:text-c-text-disabled focus:border-cpoint-turquoise outline-none"
          aria-label={t('communities.group_search_placeholder')}
        />
      )}

      {showSkeleton ? (
        <GroupListSkeleton />
      ) : visibleGroups.length === 0 ? (
        search.trim() ? (
          <div className="text-c-text-tertiary text-xs py-8 text-center">
            {t('communities.group_search_no_match', { term: search.trim() })}
          </div>
        ) : (
          <GroupsEmptyState
            variant={ownsScope ? (elsewhereCount > 0 ? 'owner-elsewhere' : 'owner-none') : 'member-none'}
            communityName={scopeNode?.name || ''}
            elsewhereCount={elsewhereCount}
            onCreate={onCreate}
            onIncludeSubs={() => setIncludeSubs(true)}
          />
        )
      ) : (
        <div className="space-y-4">
          {sections.map(section => (
            <div key={section.id} className="space-y-2">
              {section.name && sections.length > 0 && includeSubs && (
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-c-text-tertiary px-1">
                  {section.name} · {section.groups.length}
                </div>
              )}
              {section.groups.map(g => (
                <GroupCard
                  key={g.group_id}
                  group={g}
                  locusName={includeSubs ? g.community_name : null}
                  canManage={canManageGroup(g)}
                  isMember={g.status === 'member'}
                  isPending={g.status === 'pending'}
                  hasNewActivity={hasNewActivity(g)}
                  highlight={highlightGroupId === g.group_id}
                  joining={joiningGroupId === g.group_id}
                  onOpen={() => onOpenGroup(g.group_id)}
                  onJoin={async () => {
                    const res = await join(g)
                    if (!res.ok) onToast(res.error || t('communities.failed_to_join_group'))
                    else if (res.pending) onToast(t('communities.group_join_requested'))
                  }}
                  onManage={() => onManageGroup(g.group_id)}
                  onLeave={() => setConfirmAction({ kind: 'leave', group: g })}
                  onDelete={() => setConfirmAction({ kind: 'delete', group: g })}
                  onRequestsChanged={() => void reload()}
                  onError={onToast}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <ConfirmSheet
        open={!!confirmAction}
        title={confirmAction?.kind === 'delete' ? t('communities.delete_group') : t('communities.leave_group')}
        body={confirmAction?.kind === 'delete' ? t('communities.delete_group_confirm') : t('communities.leave_group_confirm')}
        confirmLabel={confirmAction?.kind === 'delete' ? t('communities.delete_group') : t('communities.leave_group')}
        destructive={confirmAction?.kind === 'delete'}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
