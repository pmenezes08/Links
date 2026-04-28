/**
 * Download / share a community calendar event as .ics (Phase 1 — device calendar import).
 */
export async function exportEventToDeviceCalendar(eventId: number | string): Promise<void> {
  const id = String(eventId)
  const res = await fetch(`/api/calendar_events/${id}/ics`, {
    credentials: 'include',
    headers: { Accept: 'text/calendar, application/json' },
  })
  if (!res.ok) {
    let msg = 'Could not load calendar file.'
    try {
      const j = await res.json()
      if (j?.message) msg = j.message
      else if (j?.error) msg = j.error
    } catch {
      /* use default */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const filename = `cpoint-event-${id}.ics`
  const file = new File([blob], filename, { type: 'text/calendar' })
  try {
    if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Add to calendar' })
      return
    }
  } catch {
    /* fall through to download */
  }
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
