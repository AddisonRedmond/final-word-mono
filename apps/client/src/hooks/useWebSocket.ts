import { useEffect, useRef } from 'react'
import { onIdTokenChanged } from 'firebase/auth'
import type { ClientMessage, ServerMessage } from "@/types/ws"
import { parseMessage, serializeMessage } from "@/types/ws"
import { auth } from '../utils/firebase/client'
import { useWsStore } from '../state/useWsStore'

interface UseWebSocketConfig {
  url: string
  onOpen?: () => void
  onMessage?: (msg: ClientMessage) => void
}

export function useWebSocket(config: UseWebSocketConfig): void {
  const store = useWsStore()
  const wsRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef(0)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queueRef = useRef<ServerMessage[]>([])
  const joinedRef = useRef(false)

  // Keep a stable ref to config to avoid stale closures in connect()
  const configRef = useRef(config)
  configRef.current = config

  // Keep a stable ref to store actions
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    function connect() {
      const { url } = configRef.current
      storeRef.current._setStatus('connecting')

      const ws = new WebSocket(url)
      wsRef.current = ws

      function send(msg: ServerMessage) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(serializeMessage(msg))
        } else {
          queueRef.current.push(msg)
        }
      }

      ws.onopen = () => {
        storeRef.current._setStatus('open')
        // Flush outbound queue in order
        for (const msg of queueRef.current) {
          ws.send(serializeMessage(msg))
        }
        queueRef.current = []
        storeRef.current._setSend(send)
        if (!joinedRef.current) {
          joinedRef.current = true
          configRef.current.onOpen?.()
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = parseMessage(event.data as string) as ClientMessage
          configRef.current.onMessage?.(msg)
          storeRef.current._setLastMessage(msg)
        } catch (e) {
          console.error('Failed to parse message:', e)
        }
      }

      ws.onclose = (event) => {
        if (event.wasClean) {
          storeRef.current._setStatus('closed')
          return
        }

        // Unexpected close — attempt reconnect
        storeRef.current._setStatus('connecting')

        if (retryCountRef.current < 5) {
          const delay = 2 ** retryCountRef.current * 1000
          retryTimeoutRef.current = setTimeout(connect, delay)
          retryCountRef.current += 1
        } else {
          storeRef.current._setStatus('closed')
        }
      }
    }

    connect()

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!user) return
      const newToken = await user.getIdToken()
      document.cookie = `token=${newToken}; path=/; SameSite=Strict`
      // Reconnect: close current connection and reconnect
      if (wsRef.current !== null) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      retryCountRef.current = 0
      connect()
    })

    return () => {
      unsubscribe()
      // Clear any pending retry timeout
      if (retryTimeoutRef.current !== null) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      // Close the WebSocket cleanly
      if (wsRef.current !== null) {
        storeRef.current._setStatus('closing')
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
