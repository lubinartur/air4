import type { Space } from '../../types'

type Props = {
  space: Space
  selected: boolean
  onSelect: (id: string) => void
}

function formatActivity(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'сейчас'
  if (mins < 60) return `${mins} мин`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч`
  const days = Math.floor(hours / 24)
  return `${days} дн`
}

export function SpaceCard({ space, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(space.id)}
      className={`space-item ${selected ? 'selected' : ''}`}
    >
      <span className="shrink-0 text-base opacity-70">{space.icon ?? '◆'}</span>
      <span className="min-w-0 flex-1 truncate">{space.name}</span>
      <span className="shrink-0 text-[11px] opacity-50">
        {formatActivity(space.lastActivity)}
      </span>
    </button>
  )
}
