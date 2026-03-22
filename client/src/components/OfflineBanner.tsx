import { useNetwork } from '../contexts/NetworkContext'

export default function OfflineBanner() {
  const { isOnline, justReconnected } = useNetwork()

  if (isOnline && !justReconnected) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center transition-all duration-300"
      style={{ paddingTop: 'max(4px, env(safe-area-inset-top, 4px))' }}
    >
      <div
        className={`px-4 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 shadow-lg backdrop-blur-md border ${
          justReconnected
            ? 'bg-green-500/20 border-green-500/30 text-green-300'
            : 'bg-red-500/20 border-red-500/30 text-red-300'
        }`}
      >
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            justReconnected ? 'bg-green-400' : 'bg-red-400 animate-pulse'
          }`}
        />
        {justReconnected ? 'Back online' : "You're offline"}
      </div>
    </div>
  )
}
