import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { drainOutbox } from '../utils/outboxDrain'

/** On native app resume, flush the offline outbox (dispatches `outbox-drained`). */
export function useResumeOutboxDrain(enabled = true): void {
  useEffect(() => {
    if (!enabled || Capacitor.getPlatform() === 'web') return

    let handle: PluginListenerHandle | undefined

    void App.addListener('resume', () => {
      void drainOutbox()
    }).then(h => {
      handle = h
    })

    return () => {
      void handle?.remove()
    }
  }, [enabled])
}
