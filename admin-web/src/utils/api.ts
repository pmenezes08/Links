const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
  })
  return res
}

export async function apiJson<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await api(path, options)
  return res.json()
}

export async function apiPost(path: string, body: any) {
  return apiJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
