/** Shapes returned by the owner-analytics endpoints (backend metric registry). */

export type OwnerMetricFormat = 'stat' | 'activity' | 'funnel' | 'segments' | 'comm' | 'leaderboards' | 'locked'

export type OwnerMetric = {
  id: string
  group: string
  format: OwnerMetricFormat
  tier: 'free' | 'paid'
  label_key: string
  hint_key?: string
  owner_only?: boolean
  locked: boolean
  // numbers for most formats; leaderboards carry {posters,repliers,reactors: [{username,count}]}
  value: Record<string, unknown> | null
}

export type OwnerSteve = {
  greeting_key: string
  read_key: string
  read_params: Record<string, number | string>
  low_data: boolean
}

export type OwnerScope = 'network' | 'self'

export type OwnerOverview = {
  success: boolean
  community: { id: number; name: string; tier: string; is_paid: boolean }
  scope: OwnerScope
  network: { available: boolean; locked: boolean; teaser_members: number | null }
  metrics: OwnerMetric[]
  steve: OwnerSteve
  generated_at: string
}

export type OwnerManagedCommunity = {
  id: number
  name: string
  role: 'owner' | 'admin'
  is_owner: boolean
  tier: string
  is_paid: boolean
  members?: number
  spaces?: number
}

export type OwnerReport = {
  report_id: number
  post_id: number
  reporter_username: string
  reason: string
  details?: string | null
  status: string
  reviewed_by?: string | null
  reviewed_at?: string | null
  reported_at?: string | null
  post_author: string
  post_content: string
  post_timestamp?: string | null
  report_count: number
  type: string
}

export type OwnerSubcommunity = {
  id: number
  name: string
  member_count: number
  active_7d?: number
  last_activity_days?: number | null
  status?: 'thriving' | 'active' | 'quiet' | 'dormant'
}

export type OwnerSpaces = {
  success: boolean
  subcommunities: OwnerSubcommunity[]
  groups: Array<{ id: number; name: string }>
}
