import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommunityGroup } from '../components/community/groups/types'

type GroupsPayload = {
  success: boolean
  joined?: CommunityGroup[]
  available?: CommunityGroup[]
  communities?: Array<{ id: number; name: string; parent_community_id?: number | null }>
  error?: string
}

/**
 * Data layer for the community-management Groups tab.
 *
 * One merged list (membership is a per-card state, not a page split),
 * scoped to a community subtree via `scopeIds`, with optimistic join and
 * request-decision handling. `scopeIds = null` means unscoped (no
 * ?parent_id): show everything the user can see.
 */
export function useCommunityGroups(scopeIds: Set<number> | null, active: boolean) {
  const [joined, setJoined] = useState<CommunityGroup[]>([])
  const [available, setAvailable] = useState<CommunityGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [joiningGroupId, setJoiningGroupId] = useState<number | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/groups/my', { credentials: 'include', headers: { Accept: 'application/json' } })
      const j: GroupsPayload | null = await r.json().catch(() => null)
      if (!aliveRef.current) return
      if (j?.success) {
        setJoined(j.joined || [])
        setAvailable(j.available || [])
      }
    } catch {
      /* keep last data; the list renders what it has */
    } finally {
      if (aliveRef.current) {
        setLoading(false)
        setLoadedOnce(true)
      }
    }
  }, [])

  useEffect(() => {
    if (active) void reload()
  }, [active, reload])

  /** Everything the viewer can see, unscoped — lets the tab count groups
   * that live outside the current scope ("N groups in sub-communities"). */
  const allGroups = useMemo<CommunityGroup[]>(
    () => [...joined, ...available.map(g => ({ ...g, status: undefined }))],
    [joined, available],
  )

  /** Merged + scope-filtered, membership first, then available; stable by community/name from the API. */
  const groups = useMemo<CommunityGroup[]>(() => {
    if (!scopeIds) return allGroups
    return allGroups.filter(g => scopeIds.has(g.community_id))
  }, [allGroups, scopeIds])

  const join = useCallback(async (group: CommunityGroup): Promise<{ ok: boolean; pending: boolean; error?: string }> => {
    setJoiningGroupId(group.group_id)
    try {
      const fd = new URLSearchParams({ group_id: String(group.group_id) })
      const r = await fetch('/api/groups/join', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) return { ok: false, pending: false, error: j?.error }
      const becamePending = Boolean(group.approval_required)
      // Optimistic move: available → joined (member or pending).
      setAvailable(prev => prev.filter(g => g.group_id !== group.group_id))
      setJoined(prev => [
        ...prev,
        { ...group, status: becamePending ? 'pending' : 'member', member_count: (group.member_count || 0) + (becamePending ? 0 : 1) },
      ])
      return { ok: true, pending: becamePending }
    } catch {
      return { ok: false, pending: false }
    } finally {
      if (aliveRef.current) setJoiningGroupId(null)
    }
  }, [])

  const leave = useCallback(async (groupId: number): Promise<boolean> => {
    try {
      const fd = new URLSearchParams({ group_id: String(groupId) })
      const r = await fetch('/api/groups/leave', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) return false
      void reload()
      return true
    } catch {
      return false
    }
  }, [reload])

  const remove = useCallback(async (groupId: number): Promise<boolean> => {
    try {
      const fd = new URLSearchParams({ group_id: String(groupId) })
      const r = await fetch('/api/groups/delete', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (!j?.success) return false
      setJoined(prev => prev.filter(g => g.group_id !== groupId))
      setAvailable(prev => prev.filter(g => g.group_id !== groupId))
      return true
    } catch {
      return false
    }
  }, [])

  return { groups, allGroups, loading, loadedOnce, reload, join, joiningGroupId, leave, remove }
}
