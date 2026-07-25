/** Shared shapes for the community-management Groups tab. */

export type CommunityNode = {
  id: number
  name: string
  type?: string
  parent_community_id?: number
  children?: CommunityNode[]
  creator_username?: string
}

export type CommunityGroup = {
  group_id: number
  name: string
  community_id: number
  community_name: string
  /** 'member' | 'pending' for rows the viewer has a membership row for; absent on available groups. */
  status?: string
  approval_required?: boolean
  steve_agent_enabled?: boolean
  created_by?: string | null
  member_count?: number
  last_activity_at?: string | null
  pending_count?: number
}

/** Deterministic accent hue per group so a wall of cards stays scannable.
 * Pure client-side: same id → same hue, everywhere, forever. */
export function groupAccentHue(groupId: number): number {
  // Knuth multiplicative hash → stable, well-spread hue.
  return Math.abs((groupId * 2654435761) % 360)
}
