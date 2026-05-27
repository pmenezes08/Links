import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'

export interface UseAndroidBackButtonOptions {
  enabled?: boolean
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Return true when selection mode was dismissed (consumes the back press). */
  onExitSelection?: () => boolean
  onNavigateBack: () => void
}

/**
 * Android hardware back: blur composer → exit selection → navigate back.
 */
export function useAndroidBackButton({
  enabled = true,
  textareaRef,
  onExitSelection,
  onNavigateBack,
}: UseAndroidBackButtonOptions): void {
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() !== 'android') return

    let handle: PluginListenerHandle | undefined

    void App.addListener('backButton', () => {
      const active = document.activeElement
      if (textareaRef?.current && active === textareaRef.current) {
        textareaRef.current.blur()
        return
      }

      if (onExitSelection?.()) return

      onNavigateBack()
    }).then(h => {
      handle = h
    })

    return () => {
      void handle?.remove()
    }
  }, [enabled, textareaRef, onExitSelection, onNavigateBack])
}
