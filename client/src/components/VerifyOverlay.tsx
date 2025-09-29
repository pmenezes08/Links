import { useState } from 'react'

export default function VerifyOverlay({ onRecheck }:{ onRecheck: ()=>void }){
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  async function resend(){
    try{
      setSending(true)
      setMsg('')
      const r = await fetch('/resend_verification', { method:'POST', credentials:'include' })
      const j = await r.json().catch(()=>null)
      if (r.ok && j?.success){ setMsg('Verification email sent. Check your inbox.') }
      else { setMsg(j?.error || 'Failed to send verification email.') }
    }catch{
      setMsg('Network error. Please try again.')
    }finally{ setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0f10] p-5 text-white">
        <div className="text-lg font-semibold">Verify your email</div>
        <div className="text-sm text-[#9fb0b5] mt-2">Please verify your email before continuing. Click the link in your inbox, then press “I’ve verified”.</div>
        {msg && <div className="mt-2 text-xs text-[#9fb0b5]">{msg}</div>}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="px-3 py-2 rounded-md border border-white/10 bg-white/5 disabled:opacity-50" onClick={resend} disabled={sending}>{sending ? 'Sending…' : 'Resend verification'}</button>
          <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black font-semibold" onClick={onRecheck}>I’ve verified</button>
        </div>
      </div>
    </div>
  )
}

