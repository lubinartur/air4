export type OrbState = 'idle' | 'typing' | 'thinking'

type Props = {
  state?: OrbState
}

const wrapStyle = {
  overflow: 'hidden',
  borderRadius: '12px',
  width: '150px',
  height: '150px',
  margin: '0 auto',
} as const

const iframeStyle = {
  border: 'none',
  width: '150px',
  height: '150px',
  borderRadius: '12px',
  overflow: 'hidden',
  display: 'block',
  background: '#000000',
} as const

export function AirchOrb(_props: Props) {
  return (
    <div className="airch-orb-wrap" style={wrapStyle}>
      <iframe
        src="/orb.html"
        title="AIRCH Orb"
        style={iframeStyle}
        scrolling="no"
      />
    </div>
  )
}
