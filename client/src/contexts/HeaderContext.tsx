import { createContext, useContext, type ReactNode } from 'react'

type HeaderContextType = {
  setTitle: (title: string) => void
  setHeaderHidden: (hidden: boolean) => void
  setTitleAccessory: (node: ReactNode | null) => void
}

export const HeaderContext = createContext<HeaderContextType>({
  setTitle: () => {},
  setHeaderHidden: () => {},
  setTitleAccessory: () => {},
})

export function useHeader(){
  return useContext(HeaderContext)
}
