import { useEffect, useRef } from 'react'

export type NetworkState = 'idle' | 'thinking' | 'responding'

const PARTICLE_COUNT = 80
const MAX_DISTANCE = 150
const BASE_SPEED = 0.3

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  opacity: number
}

interface Wave {
  cx: number
  cy: number
  radius: number
  maxRadius: number
  startTime: number
  duration: number
}

type Props = {
  state: NetworkState
}

function distance(a: Particle, b: Particle): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * BASE_SPEED * 2,
    vy: (Math.random() - 0.5) * BASE_SPEED * 2,
    radius: 1.5 + Math.random() * 1.5,
    opacity: 0.4 + Math.random() * 0.6,
  }))
}

export function NeuralBackground({ state }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef<number>(0)
  const sizeRef = useRef({ width: 0, height: 0 })
  const speedRef = useRef(1)
  const lineOpacityRef = useRef(0.15)
  const wavesRef = useRef<Wave[]>([])
  const stateRef = useRef<NetworkState>(state)
  const pulseStartRef = useRef(0)

  useEffect(() => {
    stateRef.current = state

    switch (state) {
      case 'idle':
        speedRef.current = 1
        lineOpacityRef.current = 0.15
        break
      case 'thinking':
        speedRef.current = 2.5
        lineOpacityRef.current = 0.35
        {
          const { width, height } = sizeRef.current
          if (width > 0 && height > 0) {
            wavesRef.current.push({
              cx: width / 2,
              cy: height / 2,
              radius: 0,
              maxRadius: Math.hypot(width, height) * 0.55,
              startTime: performance.now(),
              duration: 1500,
            })
          }
        }
        break
      case 'responding':
        speedRef.current = 1.8
        lineOpacityRef.current = 0.25
        pulseStartRef.current = performance.now()
        break
    }
  }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const parent = canvas.parentElement
      const width = parent?.clientWidth ?? window.innerWidth
      const height = parent?.clientHeight ?? window.innerHeight
      const dpr = window.devicePixelRatio || 1

      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      sizeRef.current = { width, height }

      if (particlesRef.current.length === 0) {
        particlesRef.current = createParticles(width, height)
      } else {
        particlesRef.current.forEach((p) => {
          p.x = Math.min(Math.max(p.x, 0), width)
          p.y = Math.min(Math.max(p.y, 0), height)
        })
      }
    }

    resize()
    window.addEventListener('resize', resize)

    const applyWaveImpulse = (now: number) => {
      const { width, height } = sizeRef.current
      wavesRef.current = wavesRef.current.filter((wave) => {
        const elapsed = now - wave.startTime
        const progress = Math.min(elapsed / wave.duration, 1)
        wave.radius = wave.maxRadius * progress

        const band = 40
        particlesRef.current.forEach((p) => {
          const dist = Math.hypot(p.x - wave.cx, p.y - wave.cy)
          if (Math.abs(dist - wave.radius) < band) {
            const angle = Math.atan2(p.y - wave.cy, p.x - wave.cx)
            const force = (1 - Math.abs(dist - wave.radius) / band) * 0.8
            p.vx += Math.cos(angle) * force
            p.vy += Math.sin(angle) * force
          }
        })

        return progress < 1
      })

      if (stateRef.current === 'responding') {
        const elapsed = now - pulseStartRef.current
        const cycle = 1800
        const phase = (elapsed % cycle) / cycle
        const pulseRadius = phase * Math.max(width, height) * 0.6
        const band = 50

        particlesRef.current.forEach((p) => {
          const cx = width / 2
          const cy = height / 2
          const dist = Math.hypot(p.x - cx, p.y - cy)
          if (Math.abs(dist - pulseRadius) < band) {
            const angle = Math.atan2(p.y - cy, p.x - cx)
            const force =
              (1 - Math.abs(dist - pulseRadius) / band) * 0.15
            p.vx += Math.cos(angle) * force
            p.vy += Math.sin(angle) * force
          }
        })
      }
    }

    const animate = (now: number) => {
      const { width, height } = sizeRef.current
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }

      ctx.clearRect(0, 0, width, height)
      applyWaveImpulse(now)

      const speed = speedRef.current
      const baseLineOpacity = lineOpacityRef.current
      const particles = particlesRef.current

      particles.forEach((p) => {
        p.x += p.vx * speed
        p.y += p.vy * speed

        if (p.x <= 0 || p.x >= width) {
          p.vx *= -1
          p.x = Math.max(0, Math.min(width, p.x))
        }
        if (p.y <= 0 || p.y >= height) {
          p.vy *= -1
          p.y = Math.max(0, Math.min(height, p.y))
        }

        p.vx *= 0.995
        p.vy *= 0.995
      })

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i]
          const p2 = particles[j]
          const dist = distance(p1, p2)
          if (dist < MAX_DISTANCE) {
            const opacity =
              (1 - dist / MAX_DISTANCE) * baseLineOpacity
            ctx.strokeStyle = `rgba(249, 115, 22, ${opacity})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }
      }

      particles.forEach((p) => {
        const alpha =
          p.opacity * (stateRef.current === 'idle' ? 0.8 : 1) * 0.6
        ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden
    />
  )
}
