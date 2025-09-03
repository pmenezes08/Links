import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; error?: any }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props){
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: any){
    return { hasError: true, error }
  }

  componentDidCatch(error: any, info: any){
    try{ console.error('React error boundary caught:', error, info) }catch{}
  }

  render(){
    if (this.state.hasError){
      const message = (this.state.error && (this.state.error.message || this.state.error.toString())) || 'Unknown error'
      return (
        <div className="p-4 text-white" style={{ backgroundColor: '#000' }}>
          <div className="text-red-400 font-semibold">Something went wrong.</div>
          <div className="text-sm text-[#9fb0b5] mt-1 break-words">{message}</div>
          <button className="mt-3 px-3 py-1.5 rounded bg-[#4db6ac] text-black" onClick={()=> location.reload()}>Reload</button>
        </div>
      )
    }
    return this.props.children as any
  }
}

