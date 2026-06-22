export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id?: number
  role: ChatRole
  content: string
  page?: string | null
  created_at?: string | null
  isMorningBrief?: boolean
  streaming?: boolean
  streamChunks?: string[]
}

export type ChatHistoryResponse = {
  messages: Array<{
    id: number
    role: ChatRole
    content: string
    page: string | null
    created_at: string | null
  }>
}

export type MorningBriefResponse = {
  should_show: boolean
  message?: string | null
}

export type Space = {
  id: string
  name: string
  icon?: string
  createdAt?: string | null
  lastActivity?: string | null
}

export type SpaceSuggestion = {
  suggest: boolean
  name?: string
  reason?: string
}

export type IdentityInsight = {
  id: number
  category: string
  insight: string
  confidence: number
  evidence_count: number
  created_at?: string | null
  updated_at?: string | null
}

export type Profile = Record<string, unknown>

export type Summary = Record<string, unknown>

export type Transaction = Record<string, unknown>
