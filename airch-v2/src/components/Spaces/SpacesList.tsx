import type { Space } from '../../types'
import { SpaceCard } from './SpaceCard'

type Props = {
  spaces?: Space[] | null
  loading?: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function SpacesList({
  spaces,
  loading = false,
  selectedId,
  onSelect,
}: Props) {
  const safeSpaces = Array.isArray(spaces) ? spaces : []

  if (loading) {
    return <p className="spaces-empty">Загрузка…</p>
  }

  if (safeSpaces.length === 0) {
    return (
      <p className="spaces-empty">
        Расскажи AIRCH о себе — он предложит первый Space
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {safeSpaces.map((space) => (
        <SpaceCard
          key={space.id}
          space={space}
          selected={selectedId === space.id}
          onSelect={(id) => onSelect(id)}
        />
      ))}
    </div>
  )
}
