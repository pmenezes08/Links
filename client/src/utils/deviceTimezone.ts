/** Reports browser/OS IANA timezone to the backend once per session when it changes (Steve reminders). */

export function syncDeviceTimezoneReporting(sessionPrefix = 'cp_tz'): void {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz || tz.trim().length === 0) return
    const key = `${sessionPrefix}_reported`
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === tz) return
    } catch {
      /* ignored */
    }
    void fetch('/api/account/timezone', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((r) => {
        if (r.ok) {
          try {
            sessionStorage.setItem(key, tz)
          } catch {
            /* ignored */
          }
        }
      })
      .catch(() => {})
  } catch {
    /* ignored */
  }
}
