import { useEffect, useState, type ReactElement } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'

/**
 * Caches mounted tab route elements so Dashboard / Feed / About stay in the
 * DOM when switching tabs — preserving scroll position without a full remount.
 */
export default function KeepAliveOutlet() {
  const location = useLocation()
  const outlet = useOutlet()
  const activePath = location.pathname
  const [cache, setCache] = useState<Map<string, ReactElement>>(() => new Map())

  useEffect(() => {
    if (!outlet) return
    setCache((prev) => {
      if (prev.has(activePath)) return prev
      const next = new Map(prev)
      next.set(activePath, outlet)
      return next
    })
  }, [activePath, outlet])

  if (cache.size === 0) {
    return outlet
  }

  return (
    <>
      {Array.from(cache.entries()).map(([path, element]) => (
        <div
          key={path}
          style={{ display: path === activePath ? 'block' : 'none' }}
          aria-hidden={path !== activePath}
          data-keep-alive-path={path}
        >
          {element}
        </div>
      ))}
    </>
  )
}
