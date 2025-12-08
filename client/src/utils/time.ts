export function parseFlexibleDate(input: any): Date | null {
  if (!input) return null
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input
  const s = String(input).trim()
  if (!s) return null
  if (s.startsWith('0000-00-00')) return null
  // Epoch seconds or ms - these are always UTC
  if (/^\d{10,13}$/.test(s)){
    const n = Number(s)
    const d = new Date(n > 1e12 ? n : n * 1000)
    return isNaN(d.getTime()) ? null : d
  }
  // ISO with timezone info (Z or +/-offset) - parse directly
  if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  // ISO-like format without timezone - treat as UTC
  // YYYY-MM-DD HH:MM[:SS] or YYYY-MM-DDTHH:MM[:SS]
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (m){
    const year = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    const HH = Number(m[4])
    const MM = Number(m[5])
    const SS = m[6] ? Number(m[6]) : 0
    // Use Date.UTC to interpret as UTC, then create Date object
    const dt = new Date(Date.UTC(year, mm - 1, dd, HH, MM, SS))
    return isNaN(dt.getTime()) ? null : dt
  }
  // YYYY-MM-DD only (no time) - treat as UTC midnight
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m){
    const year = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    const dt = new Date(Date.UTC(year, mm - 1, dd, 0, 0, 0))
    return isNaN(dt.getTime()) ? null : dt
  }
  // MM.DD.YY HH:MM (24h) - legacy format, treat as UTC
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
  if (m){
    const mm = Number(m[1]), dd = Number(m[2]), yy = Number(m[3])
    const HH = Number(m[4]), MM = Number(m[5])
    const dt = new Date(Date.UTC(2000 + yy, mm - 1, dd, HH, MM))
    return isNaN(dt.getTime()) ? null : dt
  }
  // MM/DD/YY hh:MM AM/PM - legacy format, treat as UTC
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
  if (m){
    const mm = Number(m[1]), dd = Number(m[2]), yy = Number(m[3])
    let hh = Number(m[4])
    const MM = Number(m[5])
    const ampm = m[6].toUpperCase()
    if (ampm === 'PM' && hh < 12) hh += 12
    if (ampm === 'AM' && hh === 12) hh = 0
    const dt = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, MM))
    return isNaN(dt.getTime()) ? null : dt
  }
  // DD-MM-YYYY[ HH:MM[:SS]] - legacy format, treat as UTC
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m){
    const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3])
    const HH = m[4] ? Number(m[4]) : 0
    const MM = m[5] ? Number(m[5]) : 0
    const SS = m[6] ? Number(m[6]) : 0
    const dt = new Date(Date.UTC(yyyy, mm - 1, dd, HH, MM, SS))
    return isNaN(dt.getTime()) ? null : dt
  }
  // Fallback: try native parsing (may include timezone)
  let d = new Date(s)
  if (!isNaN(d.getTime())) return d
  d = new Date(s.replace(' ', 'T'))
  if (!isNaN(d.getTime())) return d
  return null
}

function pad(n: number): string { return String(n).padStart(2, '0') }

export function formatSmartTime(input: any): string {
  const d = parseFlexibleDate(input)
  if (!d) return String(input || '')
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return 'just now'
  if (diffMs < hour){
    const mins = Math.max(1, Math.floor(diffMs / minute))
    return `${mins}min`
  }
  if (diffMs < day){
    const hours = Math.floor(diffMs / hour)
    return `${hours}h`
  }

  // Yesterday check
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - day)
  if (d >= startOfYesterday && d < startOfToday) return 'yesterday'

  // Within last 7 days -> weekday name
  const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * day)
  if (d >= sevenDaysAgo){
    try{ return d.toLocaleDateString(undefined, { weekday: 'short' }) }catch{}
    const wdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return wdays[d.getDay()]
  }

  // Full date
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`
}

