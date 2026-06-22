import type { Space } from '../../types'
import type { OrbState } from '../Neural/AirchOrb'
import { ChatWindow } from '../Chat/ChatWindow'

type Props = {
  space: Space
  onOrbStateChange: (state: OrbState) => void
}

function formatCreatedAt(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(t))
}

export function SpaceShell({ space, onOrbStateChange }: Props) {
  const createdLabel = formatCreatedAt(space.createdAt)

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-card text-lg">
          {space.icon ?? '◆'}
        </span>
        <div>
          <h1 className="text-base font-medium text-text">{space.name}</h1>
          {createdLabel && (
            <p className="text-xs text-muted">Создан {createdLabel}</p>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 border-b border-border lg:border-b-0 lg:border-r">
          <ChatWindow
            page={`space:${space.id}`}
            compact
            onOrbStateChange={onOrbStateChange}
          />
        </div>
        <aside className="hidden w-80 shrink-0 overflow-y-auto bg-card/30 p-4 lg:block">
          <p className="text-xs uppercase tracking-wide text-muted">Данные Space</p>
          <p className="mt-3 text-sm text-muted">
            AIRCH сформирует контекст этого Space по мере разговора.
          </p>
        </aside>
      </div>
    </div>
  )
}
