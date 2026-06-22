import type {
  ChatHistoryResponse,
  MorningBriefResponse,
  Space,
  SpaceSuggestion,
  Summary,
  Transaction,
  Profile,
} from '../types'

const BASE = '/api'

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export type ChatStreamCallbacks = {
  onDelta?: (text: string) => void
  onError?: (message: string) => void
}

export async function streamChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  page: string,
  callbacks: ChatStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message,
      history,
      current_page: page,
    }),
    signal,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const data = (await response.json()) as { error?: string; detail?: string }
      detail = data.error ?? data.detail ?? ''
    } catch {
      detail = await response.text().catch(() => '')
    }
    const msg = detail || `Chat failed (${response.status})`
    callbacks.onError?.(msg)
    throw new Error(msg)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('text/event-stream') || !response.body) {
    const data = (await response.json()) as Record<string, unknown> & {
      content?: string
      response?: string
      error?: string
    }
    if (data.error) {
      callbacks.onError?.(data.error)
      throw new Error(data.error)
    }
    const text = String(data.content ?? data.response ?? '')
    if (text) callbacks.onDelta?.(text)
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let assembled = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let frameEnd = buffer.indexOf('\n\n')
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd)
      buffer = buffer.slice(frameEnd + 2)
      frameEnd = buffer.indexOf('\n\n')

      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
      if (dataLines.length === 0) continue

      let event: { type?: string; text?: string }
      try {
        event = JSON.parse(dataLines.join('\n'))
      } catch {
        continue
      }

      if (event.type === 'delta') {
        const text = String(event.text ?? '')
        if (text) {
          assembled += text
          callbacks.onDelta?.(text)
        }
      } else if (event.type === 'error') {
        const msg = String(event.text ?? 'stream error')
        callbacks.onError?.(msg)
      }
    }
  }

  return assembled
}

type SpaceApiRow = {
  id: number
  name: string
  icon?: string
  created_at?: string | null
  last_active?: string | null
}

function mapSpace(row: SpaceApiRow): Space {
  return {
    id: String(row.id),
    name: row.name,
    icon: row.icon ?? '✦',
    createdAt: row.created_at ?? null,
    lastActivity: row.last_active ?? null,
  }
}

export const api = {
  sendMessage: (
    message: string,
    page: string,
    history: Array<{ role: string; content: string }> = [],
    callbacks?: ChatStreamCallbacks,
    signal?: AbortSignal,
  ) => streamChat(message, history, page, callbacks, signal),

  getChatHistory: async (limit = 50): Promise<ChatHistoryResponse> => {
    const safe = Math.max(1, Math.min(500, Math.trunc(limit)))
    const response = await fetch(`${BASE}/chat/history?limit=${safe}`)
    return parseJson<ChatHistoryResponse>(response)
  },

  getMorningBrief: async (): Promise<MorningBriefResponse> => {
    const response = await fetch(`${BASE}/chat/morning-brief`)
    return parseJson<MorningBriefResponse>(response)
  },

  getSpaces: async (): Promise<Space[]> => {
    const response = await fetch(`${BASE}/spaces`)
    const data = await parseJson<SpaceApiRow[]>(response)
    if (!Array.isArray(data)) return []
    return data.map(mapSpace)
  },

  suggestSpace: async (
    messages: Array<{ role: string; content: string }>,
  ): Promise<SpaceSuggestion> => {
    const response = await fetch(`${BASE}/spaces/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-5) }),
    })
    return parseJson<SpaceSuggestion>(response)
  },

  createSpace: async (name: string, icon = '✦'): Promise<Space> => {
    const response = await fetch(`${BASE}/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon }),
    })
    const row = await parseJson<SpaceApiRow>(response)
    return mapSpace(row)
  },

  getSummary: async (): Promise<Summary> => {
    const response = await fetch(`${BASE}/summary`)
    return parseJson<Summary>(response)
  },

  getTransactions: async (): Promise<Transaction[]> => {
    const response = await fetch(`${BASE}/transactions`)
    const data = await parseJson<{ transactions?: Transaction[] }>(response)
    return data.transactions ?? []
  },

  getProfile: async (): Promise<Profile> => {
    const response = await fetch(`${BASE}/profile`)
    return parseJson<Profile>(response)
  },
}
