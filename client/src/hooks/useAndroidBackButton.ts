import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { hasOpenModalBackHandler } from './useModalUX'

export interface UseAndroidBackButtonOptions {
  enabled?: boolean
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Return true when selection mode was dismissed (consumes the back press). */
  onExitSelection?: () => boolean
  onNavigateBack: () => void
}

/**
 * Android hardware back: blur composer → exit selection → navigate back.
 * Yields while any modal/sheet is open — the useModalUX stack owns the
 * press then (Capacitor fires every backButton listener, so without this
 * guard one press would both close the sheet AND navigate).
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
      if (hasOpenModalBackHandler()) return

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
