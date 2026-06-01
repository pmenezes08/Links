import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { NativeListRow } from '../components/NativeListRow'

type ChatAttachMenuRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
}

export function ChatAttachMenuRow({ children, className = '', ...rest }: ChatAttachMenuRowProps) {
  return (
    <NativeListRow
      haptic="selection"
      className={`gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-c-hover-bg ${className}`}
      {...rest}
    >
      {children}
    </NativeListRow>
  )
}
