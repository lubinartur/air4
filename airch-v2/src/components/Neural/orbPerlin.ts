/** Classic 3D Perlin noise — same API as CodePen `noise.perlin3`. */
class PerlinNoise {
  private readonly grad3 = [
    [1, 1, 0],
    [-1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 0, -1],
    [-1, 0, -1],
    [0, 1, 1],
    [0, -1, 1],
    [0, 1, -1],
    [0, -1, -1],
  ] as const

  private readonly perm: Uint8Array

  constructor(seed = 42) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i

    let s = seed
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647
      const j = s % (i + 1)
      const tmp = p[i]
      p[i] = p[j]
      p[j] = tmp
    }

    this.perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  private fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  private lerp(t: number, a: number, b: number) {
    return a + t * (b - a)
  }

  private dot(g: readonly [number, number, number], x: number, y: number, z: number) {
    return g[0] * x + g[1] * y + g[2] * z
  }

  perlin3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255

    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)

    const u = this.fade(x)
    const v = this.fade(y)
    const w = this.fade(z)

    const A = this.perm[X] + Y
    const AA = this.perm[A] + Z
    const AB = this.perm[A + 1] + Z
    const B = this.perm[X + 1] + Y
    const BA = this.perm[B] + Z
    const BB = this.perm[B + 1] + Z

    return this.lerp(
      w,
      this.lerp(
        v,
        this.lerp(
          u,
          this.dot(this.grad3[this.perm[AA] % 12], x, y, z),
          this.dot(this.grad3[this.perm[BA] % 12], x - 1, y, z),
        ),
        this.lerp(
          u,
          this.dot(this.grad3[this.perm[AB] % 12], x, y - 1, z),
          this.dot(this.grad3[this.perm[BB] % 12], x - 1, y - 1, z),
        ),
      ),
      this.lerp(
        v,
        this.lerp(
          u,
          this.dot(this.grad3[this.perm[AA + 1] % 12], x, y, z - 1),
          this.dot(this.grad3[this.perm[BA + 1] % 12], x - 1, y, z - 1),
        ),
        this.lerp(
          u,
          this.dot(this.grad3[this.perm[AB + 1] % 12], x, y - 1, z - 1),
          this.dot(this.grad3[this.perm[BB + 1] % 12], x - 1, y - 1, z - 1),
        ),
      ),
    )
  }
}

export const orbPerlin = new PerlinNoise()
