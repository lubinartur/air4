import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { ChatMessage, Space, SpaceSuggestion } from '../../types'
import type { OrbState } from '../Neural/AirchOrb'
import { ChatInput } from './ChatInput'
import { ChatMessage as ChatMessageBubble } from './ChatMessage'

type Props = {
  page?: string
  compact?: boolean
  onOrbStateChange: (state: OrbState) => void
  onSpaceCreated?: (space: Space) => void
}

export function ChatWindow({
  page = 'chat',
  compact = false,
  onOrbStateChange,
  onSpaceCreated,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [morningBrief, setMorningBrief] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [spaceSuggestion, setSpaceSuggestion] = useState<SpaceSuggestion | null>(
    null,
  )
  const [creatingSpace, setCreatingSpace] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const visibleMessages = messages.slice(-4)

  useEffect(() => {
    if (loading) return
    onOrbStateChange(input.length > 0 ? 'typing' : 'idle')
  }, [input, loading, onOrbStateChange])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await api.getChatHistory(50)
        if (cancelled) return
        const remote: ChatMessage[] = res.messages
          .filter(
            (m) =>
              (m.role === 'user' || m.role === 'assistant') &&
              m.content.trim() !== '',
          )
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            page: m.page,
            created_at: m.created_at,
          }))
        if (remote.length > 0) setMessages(remote)
      } catch {
        /* keep empty */
      }

      try {
        const brief = await api.getMorningBrief()
        if (cancelled || !brief.should_show || !brief.message) return
        setMorningBrief(brief.message)
        setMessages((prev) => {
          if (
            prev.some(
              (m) => m.role === 'assistant' && m.content === brief.message,
            )
          ) {
            return prev
          }
          return [
            ...prev,
            {
              role: 'assistant',
              content: brief.message!,
              isMorningBrief: true,
            },
          ]
        })
      } catch {
        /* brief is optional */
      } finally {
        if (!cancelled) setInitialized(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    setMorningBrief(null)
    setSpaceSuggestion(null)
    setInput('')
    setLoading(true)
    onOrbStateChange('thinking')

    const historyBefore = messages.filter((m) => !m.streaming)
    const userMessage: ChatMessage = { role: 'user', content: text }
    const streamingPlaceholder: ChatMessage = {
      role: 'assistant',
      content: '',
      streaming: true,
      streamChunks: [],
    }

    setMessages((prev) => [...prev, userMessage, streamingPlaceholder])

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const history = historyBefore.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const responseText = await api.sendMessage(
        text,
        page,
        history,
        {
          onDelta: (chunk) => {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.streaming) {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + chunk,
                  streamChunks: [...(last.streamChunks ?? []), chunk],
                }
              }
              return next
            })
          },
          onError: (msg) => {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.streaming) {
                next[next.length - 1] = {
                  role: 'assistant',
                  content: msg || 'Ошибка при получении ответа.',
                }
              }
              return next
            })
          },
        },
        controller.signal,
      )

      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.streaming) {
          next[next.length - 1] = { ...last, streaming: false }
        }
        return next
      })

      if (
        page === 'chat' &&
        responseText.trim() &&
        !controller.signal.aborted
      ) {
        try {
          const lastMessages = [
            ...history,
            { role: 'user', content: text },
            { role: 'assistant', content: responseText },
          ].slice(-5)
          const suggestion = await api.suggestSpace(lastMessages)
          if (suggestion.suggest && suggestion.name && suggestion.reason) {
            setSpaceSuggestion(suggestion)
          }
        } catch {
          /* suggestion is optional */
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.streaming && !last.content) {
          next[next.length - 1] = {
            role: 'assistant',
            content: 'Не удалось связаться с AIRCH. Проверь, что backend запущен.',
          }
        } else if (last?.streaming) {
          next[next.length - 1] = { ...last, streaming: false }
        }
        return next
      })
    } finally {
      setLoading(false)
      onOrbStateChange('idle')
    }
  }

  const handleCreateSpace = async () => {
    if (!spaceSuggestion?.name || creatingSpace) return
    setCreatingSpace(true)
    try {
      const space = await api.createSpace(spaceSuggestion.name)
      setSpaceSuggestion(null)
      onSpaceCreated?.(space)
    } catch {
      /* keep suggestion visible so user can retry */
    } finally {
      setCreatingSpace(false)
    }
  }

  const showGreeting =
    initialized && messages.length === 0 && !morningBrief && !loading

  return (
    <div
      className={`relative flex flex-col overflow-hidden ${compact ? 'h-full' : 'h-screen'}`}
    >
      {(showGreeting || !initialized) && (
        <div className="shrink-0 px-6 py-10 text-center">
          {showGreeting && (
            <p className="text-xl font-medium tracking-tight text-text">
              Чем могу помочь?
            </p>
          )}
          {!initialized && (
            <p className="text-sm text-muted">Загрузка…</p>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="chat-messages min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4 pt-2">
            {visibleMessages.map((msg, i) => (
              <ChatMessageBubble key={msg.id ?? i} message={msg} />
            ))}

            {spaceSuggestion?.suggest && spaceSuggestion.name && (
              <div className="space-suggestion">
                <span>✦ {spaceSuggestion.reason}</span>
                <button
                  type="button"
                  onClick={() => void handleCreateSpace()}
                  disabled={creatingSpace}
                >
                  Создать Space «{spaceSuggestion.name}»
                </button>
                <button
                  type="button"
                  onClick={() => setSpaceSuggestion(null)}
                  disabled={creatingSpace}
                >
                  Не сейчас
                </button>
              </div>
            )}
          </div>
        </div>

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={() => void handleSend()}
          disabled={loading}
        />
      </div>
    </div>
  )
}
