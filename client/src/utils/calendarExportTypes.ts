/** Shared shape for exporting a C-Point calendar event (ICS or native). */

export type CalendarExportEventFields = {
  id: number
  title: string
  date: string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  description?: string | null
  meeting_url?: string | null
  community_name?: string | null
  timezone?: string | null
  starts_at_utc?: string | null
  ends_at_utc?: string | null
}
