import { useCallback, useEffect, useState } from 'react'
import { ChatWindow } from './components/Chat/ChatWindow'
import { IdentityPage } from './components/IdentityPage'
import { AirchOrb, type OrbState } from './components/Neural/AirchOrb'
import { SpacesList } from './components/Spaces/SpacesList'
import { SpaceShell } from './components/Spaces/SpaceShell'
import { api } from './lib/api'
import type { Space } from './types'

type AppPage = 'chat' | 'identity'

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>('chat')
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
  const [spaces, setSpaces] = useState<Space[]>([])
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [orbState, setOrbState] = useState<OrbState>('idle')

  const selectedSpace = spaces.find((s) => s.id === selectedSpaceId) ?? null

  const loadSpaces = useCallback(async () => {
    try {
      const list = await api.getSpaces()
      setSpaces(Array.isArray(list) ? list : [])
    } catch {
      setSpaces([])
    } finally {
      setSpacesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSpaces()
  }, [loadSpaces])

  const handleSpaceCreated = (space: Space) => {
    setSpaces((prev) => [...prev, space])
    setSelectedSpaceId(space.id)
    setActivePage('chat')
  }

  const handleSelectSpace = (id: string | null) => {
    setSelectedSpaceId(id)
    setActivePage('chat')
  }

  const handleOpenIdentity = () => {
    setActivePage('identity')
    setSelectedSpaceId(null)
  }

  const handleOpenChat = () => {
    setActivePage('chat')
    setSelectedSpaceId(null)
  }

  return (
    <div className="app-shell h-screen overflow-hidden">
      <aside className="app-sidebar flex flex-col">
        <div className="sidebar-orb-header">
          <AirchOrb state={orbState} />
          <p className="py-2 text-center text-[11px] tracking-[0.2em] text-accent">
            PERSONAL OS
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <p className="spaces-label">Spaces</p>
          <SpacesList
            spaces={spaces ?? []}
            loading={spacesLoading}
            selectedId={selectedSpaceId}
            onSelect={handleSelectSpace}
          />
        </div>

        <button
          type="button"
          onClick={handleOpenIdentity}
          className={`identity-btn ${activePage === 'identity' ? 'selected' : ''}`}
        >
          ◎ Что обо мне знает
        </button>

        <button
          type="button"
          onClick={handleOpenChat}
          className="new-space-btn"
        >
          + Новый Space
        </button>
      </aside>

      <main className="main-content min-w-0">
        {selectedSpace ? (
          <SpaceShell
            space={selectedSpace}
            onOrbStateChange={setOrbState}
          />
        ) : activePage === 'identity' ? (
          <IdentityPage />
        ) : (
          <ChatWindow
            onOrbStateChange={setOrbState}
            onSpaceCreated={handleSpaceCreated}
          />
        )}
      </main>
    </div>
  )
}
