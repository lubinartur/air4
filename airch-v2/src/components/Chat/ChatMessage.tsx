import ReactMarkdown from 'react-markdown'
import type { ChatMessage as ChatMessageType } from '../../types'

type Props = {
  message: ChatMessageType
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'

  const body = message.streaming && message.streamChunks ? (
    <>
      {message.streamChunks.map((chunk, i) => (
        <span key={i} className="airch-fade-chunk">
          {chunk}
        </span>
      ))}
      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle" />
    </>
  ) : isUser ? (
    <span className="whitespace-pre-wrap break-words">{message.content}</span>
  ) : (
    <ReactMarkdown>{message.content}</ReactMarkdown>
  )

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`text-[15px] leading-relaxed ${
          isUser ? 'message-user text-text' : 'message-airch text-text'
        }`}
      >
        {message.isMorningBrief && (
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-accent">
            Доброе утро
          </p>
        )}
        {body}
      </div>
    </div>
  )
}
