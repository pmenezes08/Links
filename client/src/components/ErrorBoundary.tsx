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
      return (
        <div className="p-4 text-white" style={{ backgroundColor: '#000' }}>
          <div className="text-red-400 font-semibold">Something went wrong.</div>
          <div className="text-sm text-[#9fb0b5] mt-1">Please reload. If the issue persists, let us know.</div>
        </div>
      )
    }
    return this.props.children as any
  }
}

