import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { IdentityInsight } from '../types'

const CATEGORY_LABELS: Record<string, string> = {
  behavior: 'Поведение',
  pattern: 'Паттерн',
  value: 'Ценности',
  trigger: 'Триггеры',
}

const CATEGORY_COLORS: Record<string, string> = {
  behavior: 'rgba(249, 115, 22, 0.15)',
  pattern: 'rgba(124, 58, 237, 0.15)',
  value: 'rgba(6, 182, 212, 0.15)',
  trigger: 'rgba(239, 68, 68, 0.15)',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? 'rgba(255, 255, 255, 0.03)'
}

function formatConfidence(value: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return `${pct}%`
}

function observationWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'наблюдение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'наблюдения'
  return 'наблюдений'
}

export function IdentityPage() {
  const [insights, setInsights] = useState<IdentityInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const list = await api.getIdentity()
        if (!cancelled) setInsights(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить наблюдения.')
          setInsights([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const count = insights.length

  return (
    <div className="identity-page h-full overflow-y-auto">
      <div className="identity-page-inner mx-auto w-full max-w-[680px] px-6 py-10">
        <header className="identity-header mb-8">
          <h1 className="text-xl font-medium tracking-tight text-text">
            Что AIRCH знает обо мне
          </h1>
          <p className="mt-2 text-sm text-muted">
            {loading
              ? 'Загрузка…'
              : `${count} ${observationWord(count)} накоплено`}
          </p>
        </header>

        {error && (
          <p className="mb-6 text-sm text-muted">{error}</p>
        )}

        {!loading && !error && count === 0 && (
          <p className="identity-empty text-sm leading-relaxed text-muted">
            Пока пусто. Расскажи AIRCH о себе в чате — он начнёт собирать
            портрет из разговоров.
          </p>
        )}

        <div className="identity-cards">
          {insights.map((item) => (
            <article
              key={item.id}
              className="identity-card"
              style={{ background: categoryColor(item.category) }}
            >
              <p className="identity-category">{categoryLabel(item.category)}</p>
              <div className="identity-card-body">
                <p className="identity-insight">{item.insight}</p>
                <p className="identity-confidence">
                  confidence {formatConfidence(item.confidence)}
                </p>
              </div>
            </article>
          ))}
        </div>

        {!loading && count > 0 && (
          <p className="identity-footer mt-10 text-sm leading-relaxed text-muted">
            AIRCH продолжает наблюдать. Чем больше разговариваешь — тем
            точнее картина.
          </p>
        )}
      </div>
    </div>
  )
}
