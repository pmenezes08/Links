/** Shared shape for exporting a C-Point calendar event (ICS or native). */

export type CalendarExportEventFields = {
  id: number
  title: string
  date: string
  end_date?: string | null
  start_time?: string | null
  end_time?: string | null
  description?: string | null
  community_name?: string | null
}
