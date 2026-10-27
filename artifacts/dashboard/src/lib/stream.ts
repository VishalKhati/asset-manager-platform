import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Quote, Signal } from './types'

/**
 * Subscribes to the server-sent signal stream. The browser reconnects on its own and
 * sends Last-Event-ID, so events missed during a disconnect are replayed.
 */
export function useSignalStream(
  path: '/api/public/stream' | '/api/stream',
  onSignal: (s: Signal) => void,
  onQuote?: (q: Quote) => void,
) {
  const connected = ref(false)
  let source: EventSource | null = null
  onMounted(() => {
    source = new EventSource(path, { withCredentials: true })
    source.onopen = () => (connected.value = true)
    source.onerror = () => (connected.value = false)
    source.addEventListener('signal', (e) => {
      try {
        onSignal(JSON.parse((e as MessageEvent).data) as Signal)
      } catch {
        /* ignore malformed events */
      }
    })
    if (onQuote) {
      source.addEventListener('quote', (e) => {
        try {
          onQuote(JSON.parse((e as MessageEvent).data) as Quote)
        } catch {
          /* ignore malformed events */
        }
      })
    }
  })
  onBeforeUnmount(() => source?.close())
  return { connected }
}
