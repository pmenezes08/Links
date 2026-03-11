export default function StatCard({ label, value, icon, color = 'accent' }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
        <i className={`fa-solid ${icon} text-${color}`} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
