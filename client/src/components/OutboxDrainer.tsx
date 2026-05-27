import { useEffect, useRef } from 'react'
import { useNetwork } from '../contexts/NetworkContext'
import { drainOutbox } from '../utils/outboxDrain'

export default function OutboxDrainer() {
  const { justReconnected } = useNetwork()
  const drainingRef = useRef(false)

  useEffect(() => {
    if (!justReconnected || drainingRef.current) return
    drainingRef.current = true

    void drainOutbox().finally(() => {
      drainingRef.current = false
    })
  }, [justReconnected])

  return null
}
