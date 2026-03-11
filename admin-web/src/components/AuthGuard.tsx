import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../utils/api'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    apiJson('/api/check_admin')
      .then((d: any) => {
        if (!d?.is_admin) navigate('/login', { replace: true })
        else setChecked(true)
      })
      .catch(() => navigate('/login', { replace: true }))
  }, [navigate])

  if (!checked) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <i className="fa-solid fa-spinner fa-spin text-accent text-2xl" />
    </div>
  )
  return <>{children}</>
}
