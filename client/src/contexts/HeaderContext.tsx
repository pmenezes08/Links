import { createContext, useContext } from 'react'

type HeaderContextType = {
  setTitle: (title: string) => void
}

export const HeaderContext = createContext<HeaderContextType>({ setTitle: () => {} })

export function useHeader(){
  return useContext(HeaderContext)
}

