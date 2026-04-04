import { createContext, useContext } from 'react'

type HeaderContextType = {
  setTitle: (title: string) => void
  setHeaderHidden: (hidden: boolean) => void
}

export const HeaderContext = createContext<HeaderContextType>({
  setTitle: () => {},
  setHeaderHidden: () => {},
})

export function useHeader(){
  return useContext(HeaderContext)
}

