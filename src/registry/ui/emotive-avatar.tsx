"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/* -------------------------------------------------------------------------------------------------
 * Emotive Avatar
 *
 * A two-tone, eyes-only avatar (think Grok Bot / OpenAI's dots): a solid ball whose glyph eyes
 * (| |, ^ ^, o o, * *, + +, > <, hearts, spirals…) morph between emotions while the body hops,
 * squashes, sways and turns. The eyes are decals on a sphere, so they slide round the edge and
 * disappear behind the head when it turns.
 *
 * Everything renders to one <canvas>; there are no dependencies. Exports:
 *   <EmotiveAvatar />            React component (props + imperative ref)
 *   <EmotiveAvatarCrowd />       a room of drifting, bumping dots
 *   defineEmotiveAvatarElement() registers an <emotive-avatar> custom element for non-React pages
 *   AvatarCanvas / AvatarFace    the engine, for advanced use
 * -----------------------------------------------------------------------------------------------*/

/* -------------------------------------------------------------------------------------------------
 * Math helpers
 * -----------------------------------------------------------------------------------------------*/

const PI = Math.PI
const TAU = PI * 2
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1))
const pick = <T,>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]
const smooth = (t: number) => t * t * (3 - 2 * t)
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const easeOutBack = (t: number) => {
  const c1 = 1.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
const gauss = (x: number, c: number, w: number) =>
  Math.exp(-((x - c) / w) * ((x - c) / w))

type Vec2 = [number, number]
type RGB = [number, number, number]

/* -------------------------------------------------------------------------------------------------
 * Glyphs
 *
 * Authored as 1–3 cubic-bezier strokes [x0,y0, x1,y1, x2,y2, x3,y3, width] in body-radius units,
 * then resampled into polylines (see "Eye shapes").
 * -----------------------------------------------------------------------------------------------*/

type Cubic = number[]

// Glyphs are authored small; this sets their size on the face.
const EYE_SCALE = 1.45

function line(
  x0: number,
  y0: number,
  x3: number,
  y3: number,
  w: number
): Cubic {
  const dx = x3 - x0
  const dy = y3 - y0
  return [
    x0,
    y0,
    x0 + dx / 3,
    y0 + dy / 3,
    x0 + (2 * dx) / 3,
    y0 + (2 * dy) / 3,
    x3,
    y3,
    w,
  ]
}
function quad(
  x0: number,
  y0: number,
  qx: number,
  qy: number,
  x3: number,
  y3: number,
  w: number
): Cubic {
  return [
    x0,
    y0,
    x0 + (2 / 3) * (qx - x0),
    y0 + (2 / 3) * (qy - y0),
    x3 + (2 / 3) * (qx - x3),
    y3 + (2 / 3) * (qy - y3),
    x3,
    y3,
    w,
  ]
}
// Elliptical arc (≤ 180°) as a single cubic.
function arc(
  cx: number,
  cy: number,
  rx: number,
  a0: number,
  a1: number,
  w: number,
  ry = rx
): Cubic {
  const k = (4 / 3) * Math.tan((a1 - a0) / 4)
  const c0 = Math.cos(a0)
  const s0 = Math.sin(a0)
  const c1 = Math.cos(a1)
  const s1 = Math.sin(a1)
  return [
    cx + rx * c0,
    cy + ry * s0,
    cx + rx * (c0 - k * s0),
    cy + ry * (s0 + k * c0),
    cx + rx * (c1 + k * s1),
    cy + ry * (s1 - k * c1),
    cx + rx * c1,
    cy + ry * s1,
    w,
  ]
}
const dot = (x: number, y: number, w: number) => line(x, y, x, y, w)
const oval = (rx: number, ry: number, w: number) => [
  arc(0, 0, rx, PI, TAU, w, ry),
  arc(0, 0, rx, 0, PI, w, ry),
]

const GLYPHS = {
  capsule: [line(0, -0.13, 0, 0.13, 0.15)],
  small: [line(0, -0.065, 0, 0.065, 0.13)],
  o: oval(0.085, 0.11, 0.075),
  happy: [line(-0.12, 0.06, 0, -0.07, 0.11), line(0, -0.07, 0.12, 0.06, 0.11)],
  squint: [line(-0.1, -0.09, 0.08, 0, 0.11), line(0.08, 0, -0.1, 0.09, 0.11)],
  slash: [line(-0.045, 0.125, 0.045, -0.125, 0.15)],
  ring: oval(0.105, 0.125, 0.08),
  star: [0, 1, 2].map((i) => {
    const a = PI / 2 + (i * PI) / 3
    const r = 0.13
    return line(
      -r * Math.cos(a),
      -r * Math.sin(a),
      r * Math.cos(a),
      r * Math.sin(a),
      0.085
    )
  }),
  plus: [line(0, -0.12, 0, 0.12, 0.1), line(-0.12, 0, 0.12, 0, 0.1)],
  cross: [
    line(-0.09, -0.09, 0.09, 0.09, 0.1),
    line(-0.09, 0.09, 0.09, -0.09, 0.1),
  ],
  heart: [
    [0, -0.045, -0.05, -0.165, -0.215, -0.05, 0, 0.125, 0.085],
    [0, 0.125, 0.215, -0.05, 0.05, -0.165, 0, -0.045, 0.085],
  ],
  spiral: [
    arc(0, 0, 0.13, PI, TAU, 0.06),
    arc(0.04, 0, 0.09, 0, PI, 0.06),
    arc(0, 0, 0.05, PI, TAU, 0.06),
  ],
  sad: [line(-0.12, 0.0, 0.09, -0.08, 0.09), dot(-0.01, 0.08, 0.14)],
  angry: [line(-0.12, -0.1, 0.1, -0.015, 0.1), dot(-0.01, 0.08, 0.14)],
  worried: [line(-0.1, -0.075, 0.08, -0.14, 0.08), dot(0, 0.05, 0.1)],
  lid: [line(-0.12, -0.03, 0.12, -0.03, 0.09), dot(0, 0.055, 0.12)],
  sleep: [quad(-0.11, 0.02, 0, 0.1, 0.11, 0.02, 0.09)],
  dash: [line(-0.1, 0.045, 0.1, -0.045, 0.1)],
} satisfies Record<string, Cubic[]>

type GlyphName = keyof typeof GLYPHS
/** A glyph name; the right eye is mirrored automatically unless the name ends in "!". */
type GlyphRef = GlyphName | `${GlyphName}!`

// Closed glyphs that read better solid.
const FILLED = new Set<GlyphName>(["heart"])

/* -------------------------------------------------------------------------------------------------
 * Eye shapes
 *
 * Every eye is NS strokes × N evenly spaced points + a width, packed in a Float64Array. Glyphs with
 * fewer strokes are split so all three strokes carry real length, and a new shape is matched
 * (stroke order and direction) to whatever is on screen, so morphs take the shortest path.
 * -----------------------------------------------------------------------------------------------*/

const N = 16
const NS = 3
const ST = 2 * N + 1
const EYE_LEN = NS * ST
const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

type EyeShape = Float64Array
type ChainEntry = { j: number; rev: boolean }
type Chain = { entries: ChainEntry[]; closed: boolean }
type Topology = { chains: Chain[]; dots: number[] }
type Variant = { eyes: EyeShape[]; fill: boolean[] }

function sampleCubic(s: Cubic, n = 64): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    out.push([
      a * s[0] + b * s[2] + c * s[4] + d * s[6],
      a * s[1] + b * s[3] + c * s[5] + d * s[7],
    ])
  }
  return out
}
function arcLengths(pts: Vec2[]) {
  const L = [0]
  for (let i = 1; i < pts.length; i++)
    L.push(
      L[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    )
  return L
}
// n points spaced evenly by arc length between fractions t0..t1 of the path.
function resampleRange(pts: Vec2[], t0: number, t1: number, n: number): Vec2[] {
  const L = arcLengths(pts)
  const total = L[L.length - 1]
  const out: Vec2[] = []
  if (total < 1e-9) {
    for (let k = 0; k < n; k++) out.push([pts[0][0], pts[0][1]])
    return out
  }
  let j = 0
  for (let k = 0; k < n; k++) {
    const s = total * (t0 + ((t1 - t0) * k) / (n - 1))
    while (j < L.length - 2 && L[j + 1] < s) j++
    const f = clamp((s - L[j]) / (L[j + 1] - L[j] || 1))
    out.push([
      lerp(pts[j][0], pts[j + 1][0], f),
      lerp(pts[j][1], pts[j + 1][1], f),
    ])
  }
  return out
}
function buildEye(cubics: Cubic[]): EyeShape {
  type Part = { pts: Vec2[]; w: number }
  const len = (p: Part) => {
    const L = arcLengths(p.pts)
    return L[L.length - 1]
  }
  let parts: Part[] = cubics.map((s) => ({ pts: sampleCubic(s), w: s[8] }))
  if (parts.length === 1 && len(parts[0]) > 1e-6) {
    const only = parts[0]
    parts = [0, 1, 2].map((i) => ({
      pts: resampleRange(only.pts, i / 3, (i + 1) / 3, 48),
      w: only.w,
    }))
  }
  while (parts.length < NS) {
    let bi = -1
    let bl = 1e-6
    parts.forEach((p, i) => {
      const l = len(p)
      if (l > bl) {
        bl = l
        bi = i
      }
    })
    if (bi < 0) {
      parts.push({
        pts: parts[0].pts.map((q) => [q[0], q[1]] as Vec2),
        w: parts[0].w,
      })
      continue
    }
    const p = parts[bi]
    parts.splice(
      bi,
      1,
      { pts: resampleRange(p.pts, 0, 0.5, 48), w: p.w },
      { pts: resampleRange(p.pts, 0.5, 1, 48), w: p.w }
    )
  }
  const out = new Float64Array(EYE_LEN)
  parts.slice(0, NS).forEach((p, j) => {
    resampleRange(p.pts, 0, 1, N).forEach((q, k) => {
      out[j * ST + 2 * k] = q[0]
      out[j * ST + 2 * k + 1] = q[1]
    })
    out[j * ST + 2 * N] = p.w
  })
  return out
}
function mirrorEye(e: EyeShape): EyeShape {
  const out = e.slice()
  for (let j = 0; j < NS; j++)
    for (let k = 0; k < N; k++) out[j * ST + 2 * k] *= -1
  return out
}
function strokeLen(e: EyeShape, j: number) {
  let l = 0
  for (let k = 1; k < N; k++)
    l += Math.hypot(
      e[j * ST + 2 * k] - e[j * ST + 2 * k - 2],
      e[j * ST + 2 * k + 1] - e[j * ST + 2 * k - 1]
    )
  return l
}
// Reorder/reverse target's strokes to sit as close as possible to ref.
function align(target: EyeShape, ref: EyeShape): EyeShape {
  const cost = (ja: number, jb: number, rev: boolean) => {
    let c = 0
    for (let k = 0; k < N; k++) {
      const kk = rev ? N - 1 - k : k
      const dx = target[ja * ST + 2 * kk] - ref[jb * ST + 2 * k]
      const dy = target[ja * ST + 2 * kk + 1] - ref[jb * ST + 2 * k + 1]
      c += dx * dx + dy * dy
    }
    const dw = target[ja * ST + 2 * N] - ref[jb * ST + 2 * N]
    return c + dw * dw * N
  }
  let best = { perm: PERMS[0], revs: [false, false, false] }
  let bestC = Infinity
  for (const perm of PERMS) {
    let c = 0
    const revs: boolean[] = []
    for (let j = 0; j < NS; j++) {
      const f = cost(perm[j], j, false)
      const r = cost(perm[j], j, true)
      revs.push(r < f)
      c += Math.min(f, r)
    }
    if (c < bestC) {
      bestC = c
      best = { perm, revs }
    }
  }
  const out = new Float64Array(EYE_LEN)
  for (let j = 0; j < NS; j++) {
    const src = best.perm[j]
    for (let k = 0; k < N; k++) {
      const kk = best.revs[j] ? N - 1 - k : k
      out[j * ST + 2 * k] = target[src * ST + 2 * kk]
      out[j * ST + 2 * k + 1] = target[src * ST + 2 * kk + 1]
    }
    out[j * ST + 2 * N] = target[src * ST + 2 * N]
  }
  return out
}
// Which strokes connect end-to-end (drawn as one path so joins and caps stay clean), and which are dots.
function topology(e: EyeShape): Topology {
  const P = (j: number, end: boolean): Vec2 => {
    const k = end ? N - 1 : 0
    return [e[j * ST + 2 * k], e[j * ST + 2 * k + 1]]
  }
  const same = (a: Vec2, b: Vec2) =>
    Math.abs(a[0] - b[0]) < 2e-3 && Math.abs(a[1] - b[1]) < 2e-3
  const isDot = (j: number) => strokeLen(e, j) < 2e-3
  const used = new Array<boolean>(NS).fill(false)
  const chains: Chain[] = []
  const dots: number[] = []
  for (let j = 0; j < NS; j++) {
    if (used[j]) continue
    used[j] = true
    if (isDot(j)) {
      dots.push(j)
      continue
    }
    const ch: ChainEntry[] = [{ j, rev: false }]
    for (let grew = true; grew;) {
      grew = false
      const head = ch[0]
      const tail = ch[ch.length - 1]
      const hs = P(head.j, head.rev)
      const te = P(tail.j, !tail.rev)
      for (let k = 0; k < NS && !grew; k++) {
        if (used[k] || isDot(k)) continue
        if (same(P(k, false), te)) ch.push({ j: k, rev: false })
        else if (same(P(k, true), te)) ch.push({ j: k, rev: true })
        else if (same(P(k, true), hs)) ch.unshift({ j: k, rev: false })
        else if (same(P(k, false), hs)) ch.unshift({ j: k, rev: true })
        else continue
        used[k] = true
        grew = true
      }
    }
    const first = ch[0]
    const last = ch[ch.length - 1]
    chains.push({
      entries: ch,
      closed:
        ch.length > 1 && same(P(first.j, first.rev), P(last.j, !last.rev)),
    })
  }
  return { chains, dots }
}

/* -------------------------------------------------------------------------------------------------
 * Motion helpers
 * -----------------------------------------------------------------------------------------------*/

// A hop with squash on landing and stretch in the air.
function hop(t: number, period: number, height: number) {
  const p = (t / period) % 1
  const air = Math.sin(PI * p)
  const ground = Math.pow(1 - air, 8)
  const stretch = Math.abs(Math.cos(PI * p)) * (1 - ground) * 0.07
  return {
    y: -height * air,
    sy: 1 + stretch - ground * 0.09,
    sx: 1 - stretch * 0.6 + ground * 0.09,
  }
}
const heartbeat = (t: number) => {
  const p = t % 1
  return gauss(p, 0.08, 0.05) + 0.6 * gauss(p, 0.28, 0.05)
}
// Stepped rotation that snaps with a little overshoot (loading-spinner feel).
const tick = (t: number, rate: number, step: number) => {
  const s = t * rate
  return (Math.floor(s) + easeOutBack(clamp((s % 1) * 6))) * step
}

/* -------------------------------------------------------------------------------------------------
 * Moves: short one-shot animations layered on top of whatever loop is playing. Used as gestures,
 * as fidgets, and as in-betweens when the emotion changes. f(p) gets progress 0..1.
 * -----------------------------------------------------------------------------------------------*/

type MoveKey =
  "x" | "y" | "rot" | "sx" | "sy" | "s" | "yaw" | "pitch" | "eyeSy" | "eyeS"
type MoveOffsets = Partial<Record<MoveKey, number>>
type MoveDef = { dur: number; fixed?: boolean; f: (p: number) => MoveOffsets }

const MOVES = {
  // gestures
  spin: {
    dur: 0.95,
    fixed: true,
    f: (p) => ({
      yaw: TAU * easeInOut(p),
      y: -0.08 * Math.sin(PI * p),
      sy: 0.05 * Math.sin(PI * p),
    }),
  },
  nod: {
    dur: 0.85,
    f: (p) => ({ pitch: 0.32 * Math.sin(p * TAU * 2) * (1 - p) }),
  },
  shake: {
    dur: 0.95,
    f: (p) => ({ yaw: 0.55 * Math.sin(p * TAU * 2.5) * (1 - p) }),
  },
  turn: {
    dur: 2.0,
    fixed: true,
    f: (p) => {
      const b = smooth(clamp(p / 0.35)) * (1 - smooth(clamp((p - 0.62) / 0.38)))
      return { yaw: 2.9 * b, rot: 0.05 * Math.sin(PI * p) }
    },
  },
  hop: {
    dur: 0.62,
    f: (p) => {
      const a = gauss(p, 0.13, 0.08)
      const b = Math.sin(PI * clamp((p - 0.2) / 0.62))
      const l = gauss(p, 0.86, 0.06)
      return {
        y: 0.03 * a - 0.17 * b,
        sy: -0.1 * a + 0.07 * b - 0.08 * l,
        sx: 0.08 * a - 0.04 * b + 0.08 * l,
        eyeSy: -0.25 * a,
      }
    },
  },
  tilt: {
    dur: 1.1,
    f: (p) => {
      const b = Math.sin(PI * p)
      return { rot: 0.2 * b * b, yaw: 0.22 * b, pitch: -0.08 * b }
    },
  },
  glance: {
    dur: 1.6,
    f: (p) => ({
      yaw: 0.75 * Math.sin(p * TAU) * Math.sin(PI * p),
      pitch: -0.1 * Math.sin(PI * p),
    }),
  },
  yawn: {
    dur: 1.7,
    f: (p) => {
      const b = gauss(p, 0.45, 0.2)
      return {
        sy: 0.12 * b,
        sx: -0.06 * b,
        s: 0.04 * b,
        y: -0.03 * b,
        pitch: -0.25 * b,
        eyeSy: -0.9 * b,
      }
    },
  },
  nodoff: {
    dur: 2.4,
    f: (p) => {
      const d =
        p < 0.8 ? smooth(p / 0.8) : 1 - easeOutBack(clamp((p - 0.8) / 0.2))
      return { pitch: 0.5 * d, y: 0.03 * d }
    },
  },
  // in-betweens
  pop: {
    dur: 0.45,
    f: (p) => {
      const a = gauss(p, 0.18, 0.12)
      const b = gauss(p, 0.52, 0.14)
      return {
        sy: -0.12 * a + 0.12 * b,
        sx: 0.1 * a - 0.07 * b,
        y: 0.04 * a - 0.12 * b,
        eyeSy: -0.3 * a,
      }
    },
  },
  startle: {
    dur: 0.5,
    f: (p) => {
      const b = gauss(p, 0.15, 0.1)
      return {
        y: -0.1 * b,
        s: 0.07 * b,
        sy: 0.08 * b,
        sx: -0.05 * b,
        eyeS: 0.25 * b,
        pitch: -0.18 * b,
      }
    },
  },
  sigh: {
    dur: 1.0,
    f: (p) => {
      const i = gauss(p, 0.25, 0.14)
      const e = gauss(p, 0.65, 0.2)
      return {
        sy: 0.06 * i - 0.08 * e,
        sx: -0.03 * i + 0.05 * e,
        y: -0.02 * i + 0.05 * e,
        pitch: 0.25 * e,
        eyeSy: -0.85 * gauss(p, 0.6, 0.16),
      }
    },
  },
  huff: {
    dur: 0.45,
    f: (p) => {
      const u = gauss(p, 0.3, 0.15)
      return { s: 0.09 * u, sx: 0.05 * u, y: -0.02 * u, eyeSy: -0.3 * u }
    },
  },
  wake: {
    dur: 0.75,
    f: (p) => {
      const sh = Math.sin(p * PI * 6) * (1 - p)
      return {
        yaw: 0.35 * sh,
        rot: 0.06 * sh,
        y: -0.06 * gauss(p, 0.2, 0.12),
        eyeSy: -0.8 * gauss(p, 0.08, 0.07),
      }
    },
  },
  melt: {
    dur: 0.8,
    f: (p) => {
      const w = Math.sin(p * PI * 3) * (1 - p)
      return { sx: 0.08 * w, sy: -0.08 * w, s: 0.05 * gauss(p, 0.2, 0.15) }
    },
  },
  blink: { dur: 0.28, f: (p) => ({ eyeSy: -0.92 * gauss(p, 0.5, 0.22) }) },
} satisfies Record<string, MoveDef>

type MoveName = keyof typeof MOVES
const MOVE_DEFS: Record<MoveName, MoveDef> = MOVES

const GESTURES = [
  "spin",
  "nod",
  "shake",
  "turn",
  "hop",
  "tilt",
  "glance",
  "yawn",
] as const
type GestureName = (typeof GESTURES)[number]
const MOVE_KEYS: MoveKey[] = [
  "x",
  "y",
  "rot",
  "sx",
  "sy",
  "s",
  "yaw",
  "pitch",
  "eyeSy",
  "eyeS",
]
const isGesture = (n: string): n is GestureName =>
  (GESTURES as readonly string[]).includes(n)

/* -------------------------------------------------------------------------------------------------
 * Emotions
 *
 * Each one is a loop: `motion` is called every frame with the time since the emotion started and
 * the intensity, and returns a body pose. yaw/pitch turn the head.
 * -----------------------------------------------------------------------------------------------*/

type PoseKey =
  "x" | "y" | "rot" | "sx" | "sy" | "s" | "glitch" | "yaw" | "pitch"
type Pose = Record<PoseKey, number>
type EyeAnim = { dx: number; dy: number; rot: number; s: number; sy: number }
type ParticleType =
  "z" | "heart" | "spark" | "dot" | "puff" | "tear" | "drop" | "q"
type Orbit = { a: number; va: number; rx: number; ry: number; cy: number }
type Particle = {
  type: ParticleType
  x: number
  y: number
  vx: number
  vy: number
  g: number
  life: number
  age: number
  delay: number
  size: number
  grow: number
  rot: number
  vr: number
  onBody: boolean
  fromEye?: boolean
  orbit?: Orbit
}
type ParticleSpec = Partial<Particle> & { type: ParticleType }
type Emitter = { every: number; spawn: () => ParticleSpec | ParticleSpec[] }

type EmotionDef = {
  label: string
  /** [left, right]. The right eye is mirrored unless the glyph name ends in "!". */
  eyes: [GlyphRef, GlyphRef]
  /** Override used by the "type" eye style. */
  typeEyes?: [GlyphRef, GlyphRef]
  blink?: boolean
  /** Body colour used when `moodTint` is on. */
  tint?: string
  /** [valence, arousal] position on the mood map. */
  va?: Vec2
  /** false keeps it off the mood map (it can still be set directly). */
  mood?: boolean
  /** Ignore the pointer / lookAt and keep the emotion's own gaze. */
  lockGaze?: boolean
  gaze?: Vec2 | ((t: number, k: number) => Vec2)
  wander?: { range: number; every: Vec2; bias?: Vec2 }
  /** Moves it does on its own now and then. */
  fidgets?: MoveName[]
  fidgetRate?: number
  motion?: (t: number, k: number) => Partial<Pose>
  eye?: (t: number, k: number, i: number) => Partial<EyeAnim>
  particles?: Emitter[]
}

const EMOTIONS = {
  idle: {
    label: "Idle",
    eyes: ["capsule", "capsule"],
    typeEyes: ["o", "o"],
    blink: true,
    va: [0, 0],
    wander: { range: 0.55, every: [1.2, 3.4] },
    fidgets: ["glance", "tilt", "nod", "hop", "glance", "turn"],
    motion: (t, k) => ({
      y: Math.sin(t * 1.7) * 0.02 * k,
      sy: 1 + Math.sin(t * 1.7 + 1) * 0.012 * k,
      sx: 1 - Math.sin(t * 1.7 + 1) * 0.012 * k,
      rot: Math.sin(t * 0.6) * 0.03 * k,
    }),
  },
  happy: {
    label: "Happy",
    eyes: ["happy", "happy"],
    tint: "#ffd23f",
    va: [0.85, 0.3],
    wander: { range: 0.25, every: [1.5, 3], bias: [0, -0.15] },
    fidgets: ["spin", "nod", "tilt"],
    motion: (t, k) => ({
      ...hop(t, 0.9, 0.1 * k),
      rot: Math.sin((t * PI) / 0.9) * 0.05 * k,
    }),
  },
  excited: {
    label: "Excited",
    eyes: ["star", "star"],
    tint: "#ff9f1c",
    va: [0.55, 0.95],
    fidgetRate: 1.8,
    wander: { range: 0.3, every: [0.4, 1] },
    fidgets: ["spin", "spin", "shake"],
    motion: (t, k) => ({
      ...hop(t, 0.42, 0.08 * k),
      rot: Math.sin(t * 13) * 0.07 * k,
    }),
    eye: (t, k, i) => ({
      rot: (i ? -1 : 1) * t * 2.4,
      s: 1 + Math.sin(t * 10) * 0.1 * k,
    }),
    particles: [
      {
        every: 0.28,
        spawn: () => {
          const a = rand(0, TAU)
          const r = rand(1.15, 1.35)
          return {
            type: "spark",
            x: Math.cos(a) * r,
            y: Math.sin(a) * r * 0.9 - 0.1,
            life: 0.6,
            size: rand(0.08, 0.13),
            grow: 0.4,
          }
        },
      },
    ],
  },
  laughing: {
    label: "Laughing",
    eyes: ["squint", "squint"],
    tint: "#ffb703",
    va: [0.9, 0.7],
    gaze: [0, -0.2],
    motion: (t, k) => ({
      y: -Math.abs(Math.sin(t * 15)) * 0.035 * k,
      rot: Math.sin(t * 5) * 0.09 * k,
      sx: 1 + Math.sin(t * 30) * 0.025 * k,
      sy: 1 - Math.sin(t * 30) * 0.025 * k,
      pitch: -0.1 * k,
    }),
  },
  love: {
    label: "Love",
    eyes: ["heart", "heart"],
    tint: "#ff5d8f",
    va: [0.8, -0.2],
    gaze: (t) => [Math.sin(t * 0.7) * 0.15, -0.1],
    fidgets: ["tilt"],
    motion: (t, k) => ({
      s: 1 + heartbeat(t) * 0.06 * k,
      rot: Math.sin(t * 1.4) * 0.07 * k,
      y: Math.sin(t * 2.8) * 0.015 * k,
    }),
    eye: (t, k) => ({ s: 1 + heartbeat(t) * 0.22 * k }),
    particles: [
      {
        every: 0.65,
        spawn: () => ({
          type: "heart",
          x: rand(-0.7, 0.7),
          y: rand(-0.95, -0.7),
          vx: rand(-0.12, 0.12),
          vy: -0.38,
          life: 1.8,
          size: rand(0.09, 0.15),
          rot: rand(-0.3, 0.3),
        }),
      },
    ],
  },
  playful: {
    label: "Playful",
    eyes: ["slash", "slash"],
    tint: "#8be04e",
    va: [0.45, 0.55],
    gaze: (t) => [Math.sin(t * 2.4) * 0.55, -0.25],
    fidgets: ["spin", "hop"],
    motion: (t, k) => ({
      x: Math.sin(t * 2.4) * 0.06 * k,
      rot: Math.sin(t * 2.4) * 0.15 * k,
      y: -Math.abs(Math.sin(t * 4.8)) * 0.03 * k,
    }),
  },
  wink: {
    label: "Wink",
    eyes: ["capsule", "happy"],
    typeEyes: ["o", "happy"],
    tint: "#c77dff",
    va: [0.6, 0.3],
    mood: false,
    gaze: [0.25, -0.1],
    motion: (t, k) => {
      const j = t < 0.35 ? Math.sin((t / 0.35) * PI) * 0.06 * k : 0
      return {
        y: -j + Math.sin(t * 2) * 0.012 * k,
        rot: (0.13 + Math.sin(t * 2) * 0.02) * k,
      }
    },
  },
  shy: {
    label: "Shy",
    eyes: ["small", "small"],
    blink: true,
    tint: "#ff8fab",
    va: [0.4, -0.6],
    lockGaze: true,
    gaze: [0, 0.3],
    motion: (t, k) => {
      const peek = gauss((t % 3.6) / 3.6, 0.55, 0.1)
      return {
        yaw: (1.25 - 0.95 * peek) * k,
        rot: -0.1 * k,
        y: 0.03 * k,
        s: 1 - 0.04 * k,
        sx: 1 + Math.sin(t * 1.3) * 0.01,
      }
    },
  },
  curious: {
    label: "Curious",
    eyes: ["capsule", "capsule"],
    typeEyes: ["o", "o"],
    blink: true,
    tint: "#4cc9f0",
    va: [0.15, 0.4],
    wander: { range: 0.85, every: [0.5, 1.6] },
    fidgets: ["glance", "tilt", "glance"],
    eye: (_t, _k, i) => (i ? { s: 0.78, dy: -0.04 } : { s: 1.12 }),
    motion: (t, k) => {
      const r = 0.17 * k * Math.tanh(3 * Math.sin(t * 1.1))
      return { rot: r, x: r * 0.25, y: Math.sin(t * 2.2) * 0.01 * k }
    },
    particles: [
      {
        every: 3.2,
        spawn: () => ({
          type: "q",
          x: 0.82,
          y: -0.92,
          vy: -0.08,
          life: 1.7,
          size: 0.15,
          rot: 0.15,
        }),
      },
    ],
  },
  thinking: {
    label: "Thinking",
    eyes: ["small", "small"],
    blink: true,
    tint: "#a0a0ff",
    va: [0.05, 0.1],
    mood: false,
    gaze: (t) => [0.55 + Math.sin(t * 0.7) * 0.12, -0.75],
    fidgets: ["tilt"],
    motion: (t, k) => ({
      rot: (-0.08 + Math.sin(t * 0.9) * 0.02) * k,
      y: Math.sin(t * 1.2) * 0.012 * k,
    }),
    particles: [
      {
        every: 2.2,
        spawn: () =>
          [0, 1, 2].map((i) => ({
            type: "dot",
            x: 0.72 + i * 0.17,
            y: -0.95 - i * 0.09,
            delay: i * 0.28,
            life: 1.5 - i * 0.28,
            size: 0.05 + i * 0.012,
          })),
      },
    ],
  },
  working: {
    label: "Working",
    eyes: ["plus", "plus"],
    tint: "#10b04f",
    lockGaze: true,
    va: [0.1, 0.35],
    mood: false,
    gaze: (t) => [Math.sin(t * 0.8) * 0.25, 0.05],
    fidgets: ["nod"],
    motion: (t, k) => ({
      y: Math.sin(t * 4) * 0.012 * k,
      rot: Math.sin(t * 0.8) * 0.04 * k,
    }),
    eye: (t, _k, i) => ({ rot: tick(t + i * 0.12, 1.4, PI / 2) }),
  },
  skeptical: {
    label: "Skeptical",
    eyes: ["dash", "dash!"],
    tint: "#ff7a1f",
    va: [-0.5, 0.1],
    gaze: (t) => [0.45 + Math.sin(t * 0.5) * 0.1, 0.1],
    fidgets: ["tilt", "shake"],
    eye: (t, k, i) =>
      i
        ? { dy: -0.07 - Math.max(0, Math.sin(t * 1.3)) * 0.03 * k }
        : { dy: 0.08 },
    motion: (t, k) => ({
      rot: (-0.22 + Math.sin(t * 0.7) * 0.03) * k,
      x: -0.03 * k,
      y: Math.sin(t * 1.1) * 0.01 * k,
    }),
  },
  surprised: {
    label: "Surprised",
    eyes: ["ring", "ring"],
    blink: true,
    tint: "#ffe66d",
    va: [0.05, 0.95],
    wander: { range: 0.2, every: [1.5, 3] },
    motion: (t, k) => {
      const j = t < 0.4 ? Math.sin((t / 0.4) * PI) * 0.14 * k : 0
      return {
        y: -j,
        sy: 1 + j * 0.5 + 0.02 * k,
        sx: 1 - j * 0.4,
        x: Math.sin(t * 40) * 0.003 * k,
      }
    },
    eye: (t, k) => ({ s: 1 + Math.sin(t * 6) * 0.05 * k }),
  },
  scared: {
    label: "Scared",
    eyes: ["worried", "worried"],
    blink: true,
    tint: "#b8f2e6",
    va: [-0.5, 0.85],
    wander: { range: 0.9, every: [0.15, 0.55] },
    fidgets: ["glance"],
    fidgetRate: 1.5,
    motion: (t, k) => ({
      x: (Math.sin(t * 47) * 0.012 + Math.sin(t * 31) * 0.008) * k,
      s: 1 - 0.08 * k,
      y: 0.04 * k,
      sy: 0.97,
    }),
    particles: [
      {
        every: 2.0,
        spawn: () => ({
          type: "drop",
          x: 1.02,
          y: -0.5,
          vy: 0.22,
          g: 0.4,
          life: 1.0,
          size: 0.1,
        }),
      },
    ],
  },
  sad: {
    label: "Sad",
    eyes: ["sad", "sad"],
    blink: true,
    tint: "#5e8bff",
    va: [-0.85, -0.35],
    gaze: (t) => [Math.sin(t * 0.3) * 0.2, 0.6],
    fidgets: ["sigh"],
    motion: (t, k) => ({
      y: 0.05 * k + Math.sin(t * 0.9) * 0.01 * k,
      sy: 1 - 0.05 * k,
      sx: 1 + 0.04 * k,
      rot: Math.sin(t * 0.5) * 0.04 * k,
    }),
    particles: [
      {
        every: 1.5,
        spawn: () => ({
          type: "tear",
          onBody: true,
          fromEye: true,
          vy: 0.32,
          g: 0.2,
          life: 1.3,
          size: 0.07,
        }),
      },
    ],
  },
  angry: {
    label: "Angry",
    eyes: ["angry", "angry"],
    tint: "#ff4d4d",
    lockGaze: true,
    va: [-0.85, 0.5],
    gaze: [0, 0.1],
    fidgets: ["huff", "shake"],
    motion: (t, k) => {
      const h = gauss((t % 1.6) / 1.6, 0.1, 0.06)
      return {
        x: Math.sin(t * 55) * 0.006 * k,
        sx: 1 + 0.07 * h * k,
        sy: 1 - 0.06 * h * k,
        y: 0.01,
        pitch: 0.06 * k,
      }
    },
    particles: [
      {
        every: 1.6,
        spawn: () =>
          [-1, 1].map((d) => ({
            type: "puff",
            x: d * 0.62,
            y: -0.88,
            vx: d * 0.3,
            vy: -0.35,
            life: 0.9,
            size: 0.09,
            grow: 1.4,
          })),
      },
    ],
  },
  bored: {
    label: "Bored",
    eyes: ["lid", "lid"],
    blink: true,
    tint: "#9aa0a6",
    va: [-0.45, -0.65],
    wander: { range: 0.4, every: [2, 4.5], bias: [0.35, 0.15] },
    fidgets: ["yawn", "glance", "tilt"],
    motion: (t, k) => {
      const p = (t % 4.5) / 4.5
      const sigh = Math.sin(clamp((p - 0.1) / 0.4) * PI)
      return {
        rot: Math.sin(t * 0.6) * 0.05 * k,
        y: (0.02 + sigh * 0.03) * k,
        sy: 1 - sigh * 0.05 * k,
        sx: 1 + sigh * 0.03 * k,
      }
    },
  },
  sleepy: {
    label: "Sleepy",
    eyes: ["sleep", "sleep"],
    tint: "#7b6cff",
    lockGaze: true,
    va: [0, -0.95],
    gaze: [0, 0.35],
    fidgets: ["nodoff"],
    fidgetRate: 0.8,
    motion: (t, k) => {
      const b = Math.sin((t * TAU) / 3.2)
      return {
        sy: 1 + b * 0.03 * k,
        sx: 1 - b * 0.02 * k,
        y: (0.05 + b * 0.01) * k,
        rot: (0.1 + Math.sin(t * 0.3) * 0.03) * k,
      }
    },
    particles: [
      {
        every: 1.4,
        spawn: () => ({
          type: "z",
          x: 0.55,
          y: -0.75,
          vx: 0.2,
          vy: -0.26,
          life: 2.6,
          size: 0.07,
          grow: 0.9,
          rot: -0.2,
        }),
      },
    ],
  },
  dizzy: {
    label: "Dizzy",
    eyes: ["spiral", "spiral"],
    tint: "#00c2a8",
    lockGaze: true,
    va: [-0.2, 0.6],
    mood: false,
    gaze: [0, 0],
    motion: (t, k) => ({
      x: Math.cos(t * 3.4) * 0.06 * k,
      y: Math.sin(t * 3.4) * 0.03 * k,
      rot: Math.sin(t * 3.4) * 0.12 * k,
      yaw: Math.sin(t * 2.2) * 0.9 * k,
      pitch: Math.cos(t * 2.2) * 0.25 * k,
    }),
    eye: (t, _k, i) => ({ rot: (i ? -1 : 1) * t * 7 }),
    particles: [
      {
        every: 0.95,
        spawn: () => ({
          type: "spark",
          orbit: { a: -PI / 2, va: 3.2, rx: 0.75, ry: 0.18, cy: -1.02 },
          life: 2.85,
          size: 0.09,
        }),
      },
    ],
  },
  error: {
    label: "Error",
    eyes: ["cross", "cross"],
    tint: "#e5e5e5",
    lockGaze: true,
    va: [-0.3, 0.3],
    mood: false,
    gaze: [0, 0],
    fidgets: ["shake"],
    motion: (t, k) => ({ glitch: 0.06 * k, rot: Math.sin(t * 0.8) * 0.02 * k }),
  },
} satisfies Record<string, EmotionDef>

type EmotionName = keyof typeof EMOTIONS
const EMOTION_DEFS: Record<EmotionName, EmotionDef> = EMOTIONS
const EMOTION_NAMES = Object.keys(EMOTIONS) as EmotionName[]
const isEmotion = (n: string): n is EmotionName => n in EMOTIONS

function buildVariant([l, r]: [GlyphRef, GlyphRef]): Variant {
  const ln = l.replace("!", "") as GlyphName
  const rn = r.replace("!", "") as GlyphName
  const R = buildEye(GLYPHS[rn])
  return {
    eyes: [buildEye(GLYPHS[ln]), r.endsWith("!") ? R : mirrorEye(R)],
    fill: [FILLED.has(ln), FILLED.has(rn)],
  }
}
// Built lazily (first use) so importing the module stays cheap.
let VARIANTS: Record<EmotionName, { pill: Variant; type: Variant }> | null =
  null
function variants() {
  if (!VARIANTS) {
    const v = {} as Record<EmotionName, { pill: Variant; type: Variant }>
    for (const name of EMOTION_NAMES) {
      const d = EMOTION_DEFS[name]
      const pill = buildVariant(d.eyes)
      v[name] = { pill, type: d.typeEyes ? buildVariant(d.typeEyes) : pill }
    }
    VARIANTS = v
  }
  return VARIANTS
}

type EmotionMix = Partial<Record<EmotionName, number>>

/** Blend for a point on the mood map: valence (-1 unhappy … 1 happy) × arousal (-1 calm … 1 energetic). */
function moodMix(valence: number, arousal: number): EmotionMix {
  const near3 = EMOTION_NAMES.filter(
    (n) => EMOTION_DEFS[n].va && EMOTION_DEFS[n].mood !== false
  )
    .map((n) => {
      const va = EMOTION_DEFS[n].va as Vec2
      return { n, dist: Math.hypot(va[0] - valence, va[1] - arousal) }
    })
    .sort((p, q) => p.dist - q.dist)
    .slice(0, 3)
  const ws = near3.map((o) => 1 / Math.pow(o.dist * o.dist + 0.004, 1.5))
  const W = ws.reduce((s, w) => s + w, 0)
  const mix: EmotionMix = {}
  near3.forEach((o, i) => {
    if (ws[i] / W > 0.06) mix[o.n] = ws[i] / W
  })
  return mix
}

/* -------------------------------------------------------------------------------------------------
 * Loops
 * -----------------------------------------------------------------------------------------------*/

/** A loop step: "happy:2", "spin", "sad:3 talk", [name, seconds?, talk?] or an object. */
type LoopStepInput =
  | string
  | [string, number?, boolean?]
  | { emotion: string; duration?: number; speak?: boolean }
type LoopStep = {
  emotion: EmotionName | GestureName
  duration: number
  speak: boolean
  gesture: boolean
}

const ROUTINES = {
  daydream: {
    label: "Daydream",
    steps: [
      ["idle", 3],
      ["curious", 3],
      ["glance"],
      ["thinking", 3.5],
      ["happy", 2.5],
    ],
  },
  wakeup: {
    label: "Wake up",
    steps: [
      ["sleepy", 4],
      ["surprised", 1.2],
      ["dizzy", 2],
      ["idle", 1.5],
      ["excited", 2.5],
      ["happy", 3],
    ],
  },
  coaster: {
    label: "Rollercoaster",
    steps: [
      ["excited", 2],
      ["scared", 2],
      ["surprised", 1.2],
      ["laughing", 2.5],
      ["dizzy", 2],
      ["love", 2.5],
    ],
  },
  peekaboo: {
    label: "Peekaboo",
    steps: [
      ["shy", 3.6],
      ["turn"],
      ["surprised", 0.8],
      ["laughing", 2],
      ["spin"],
      ["playful", 2.5],
    ],
  },
  badday: {
    label: "Bad day",
    steps: [
      ["bored", 3],
      ["skeptical", 2.5],
      ["sad", 3.5],
      ["angry", 2.5],
      ["sleepy", 3.5],
    ],
  },
  assistant: {
    label: "Assistant",
    steps: [
      ["idle", 2],
      ["curious", 1.8],
      ["thinking", 2.5],
      ["working", 2.5],
      ["nod"],
      ["happy", 2.5, true],
      ["idle", 2.5, true],
      ["wink", 1.5],
    ],
  },
  chatty: {
    label: "Chatty",
    steps: [
      ["idle", 2.5, true],
      ["happy", 2.5, true],
      ["curious", 2, true],
      ["laughing", 2],
      ["wink", 1.5],
      ["skeptical", 2, true],
    ],
  },
} satisfies Record<string, { label: string; steps: LoopStepInput[] }>

type RoutineName = keyof typeof ROUTINES
const ROUTINE_DEFS: Record<
  RoutineName,
  { label: string; steps: LoopStepInput[] }
> = ROUTINES

function parseSteps(steps: string | LoopStepInput[]): LoopStep[] {
  const list: LoopStepInput[] =
    typeof steps === "string" ? steps.split(/[,\n;]+/) : steps
  const dflt = (n: string) => (isGesture(n) ? MOVE_DEFS[n].dur : 2.5)
  const out: LoopStep[] = []
  for (const s of list) {
    let name: string
    let duration: number | undefined
    let speak: boolean
    if (typeof s === "string") {
      const m = s
        .trim()
        .toLowerCase()
        .match(/^([a-z]+)\s*[:\s]?\s*([\d.]+)?\s*(talk|speak)?$/)
      if (!m) continue
      name = m[1]
      duration = m[2] ? parseFloat(m[2]) : undefined
      speak = !!m[3]
    } else if (Array.isArray(s)) {
      ;[name, duration, speak = false] = s
    } else {
      name = s.emotion
      duration = s.duration
      speak = !!s.speak
    }
    const d = duration || dflt(name)
    if (isEmotion(name))
      out.push({ emotion: name, duration: d, speak, gesture: false })
    else if (isGesture(name))
      out.push({ emotion: name, duration: d, speak, gesture: true })
  }
  return out.filter((s) => s.duration > 0)
}

/* -------------------------------------------------------------------------------------------------
 * Colours
 * -----------------------------------------------------------------------------------------------*/

const colorCache = new Map<string, RGB>()
let probe: CanvasRenderingContext2D | null = null

/** Any CSS colour the canvas understands (hex, rgb(), oklch(), names…) → [r, g, b]. */
function parseColor(c: string): RGB {
  const hit = colorCache.get(c)
  if (hit) return [hit[0], hit[1], hit[2]]
  let out: RGB = [0, 0, 0]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (hex) {
    let h = hex[1]
    if (h.length === 3)
      h = h
        .split("")
        .map((x) => x + x)
        .join("")
    const n = parseInt(h, 16)
    out = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  } else if (typeof document !== "undefined") {
    probe ??= document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true })
    if (probe) {
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = "#000"
      probe.fillStyle = c
      probe.fillRect(0, 0, 1, 1)
      const d = probe.getImageData(0, 0, 1, 1).data
      out = [d[0], d[1], d[2]]
    }
  }
  colorCache.set(c, out)
  return [out[0], out[1], out[2]]
}
const rgbStr = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`

/** Resolves var(--token) / currentColor against an element so theme tokens work. */
function resolveCssColor(el: HTMLElement, value: string): string {
  if (!/var\(|currentcolor/i.test(value)) return value
  const prev = el.style.color
  el.style.color = value
  const out = getComputedStyle(el).color
  el.style.color = prev
  return out
}

/* -------------------------------------------------------------------------------------------------
 * Face: one avatar's state, behaviour and drawing. Hosts decide where it goes.
 * -----------------------------------------------------------------------------------------------*/

type EyeStyle = "pill" | "type"

const STYLES: Record<
  EyeStyle,
  { cap: CanvasLineCap; join: CanvasLineJoin; weight: number }
> = {
  pill: { cap: "round", join: "round", weight: 1 },
  type: { cap: "butt", join: "miter", weight: 0.62 },
}

type AvatarOptions = {
  /** Body colour. Any CSS colour, including var(--token). */
  body: string
  /** Eye colour. */
  eyes: string
  /** Colour of particles outside the body (z's, hearts…). Defaults to the body colour. */
  particleColor: string | null
  /** "pill": rounded Grok-style strokes. "type": flat-capped, typographic. */
  style: EyeStyle
  /** Body radius as a fraction of the canvas' short side. */
  size: number
  /** Motion amplitude multiplier (0–2). */
  intensity: number
  /** Blend the body colour toward each emotion's tint. */
  moodTint: boolean
  shadow: boolean
  particles: boolean
  blink: boolean
  /** Always look at the pointer. */
  lookAtPointer: boolean
  /** Clickable (poke) and aware of the pointer. */
  interactive: boolean
  /** Fidgets, notices the pointer, startles, gets bored then sleepy when left alone while idle. */
  alive: boolean
  boredAfter: number
  sleepAfter: number
  emotion: EmotionName
}

const DEFAULTS: AvatarOptions = {
  body: "#ffffff",
  eyes: "#141414",
  particleColor: null,
  style: "pill",
  size: 0.3,
  intensity: 1,
  moodTint: false,
  shadow: true,
  particles: true,
  blink: true,
  lookAtPointer: false,
  interactive: true,
  alive: true,
  boredAfter: 20,
  sleepAfter: 45,
  emotion: "idle",
}

type Member = {
  name: EmotionName
  def: EmotionDef
  target: number
  w: number
  n: number
  start: number
  acc: number[]
  eyes: EyeShape[]
  topo: Topology[]
  fill: boolean[]
}

type AvatarEvents = {
  emotion: EmotionName
  step: { index: number; step: LoopStep; total: number }
  routine: { name: string; steps: LoopStep[] } | null
  poke: undefined
  auto: "bored" | "sleepy"
}
type Listener<K extends keyof AvatarEvents> = (data: AvatarEvents[K]) => void

type Routine = {
  name: string
  steps: LoopStep[]
  idx: number
  el: number
  loop: boolean
  shuffle?: boolean
}

const POSE_KEYS: PoseKey[] = [
  "x",
  "y",
  "rot",
  "sx",
  "sy",
  "s",
  "glitch",
  "yaw",
  "pitch",
]
const KICK_KEYS = ["x", "y", "rot", "yaw", "pitch", "s"] as const
type KickKey = (typeof KICK_KEYS)[number]
const basePose = (): Pose => ({
  x: 0,
  y: 0,
  rot: 0,
  sx: 1,
  sy: 1,
  s: 1,
  glitch: 0,
  yaw: 0,
  pitch: 0,
})
const zeroKick = (): Record<KickKey, number> => ({
  x: 0,
  y: 0,
  rot: 0,
  yaw: 0,
  pitch: 0,
  s: 0,
})
const mixKey = (mix: EmotionMix) =>
  (Object.keys(mix) as EmotionName[])
    .sort()
    .map((n) => `${n}:${(mix[n] ?? 0).toFixed(3)}`)
    .join(",")
function normMix(mix: EmotionMix): EmotionMix | null {
  let W = 0
  for (const n of Object.keys(mix))
    if (isEmotion(n) && (mix[n] ?? 0) > 0) W += mix[n] ?? 0
  if (W <= 0) return null
  const out: EmotionMix = {}
  for (const n of Object.keys(mix))
    if (isEmotion(n) && (mix[n] ?? 0) > 0) out[n] = (mix[n] ?? 0) / W
  return out
}

class AvatarFace {
  opts: AvatarOptions
  t = 0
  pose: Pose = basePose()
  head = { yaw: 0, pitch: 0 }
  /** Look here, in body radii from the face centre (set by the host). */
  lookAt: Vec2 | null = null
  /** Pointer info for autonomous noticing (set by the host). */
  attn: { x: number; y: number; speed: number } | null = null
  bump = 0
  bumpV = 0
  routine: Routine | null = null
  mood: Vec2 | null = null
  /** Turns a raw colour option (e.g. var(--foreground)) into something the canvas can parse. */
  colorResolver: (value: string) => string = (v) => v

  private listeners: { [K in keyof AvatarEvents]?: Listener<K>[] } = {}
  private base: EmotionMix
  private reactQueue: { name: EmotionName; until: number }[] = []
  private autoMood: "bored" | "sleepy" | null = null
  private members: Member[] = []
  private dom!: Member
  private shownDom!: Member
  private effKey = ""
  private eyeShown: EyeShape[] | null = null
  private eyeVel = [new Float64Array(EYE_LEN), new Float64Array(EYE_LEN)]
  private tgt = [new Float64Array(EYE_LEN), new Float64Array(EYE_LEN)]
  private proj = new Float64Array(NS * N * 3)
  private eyeT: EyeAnim[] = [
    { dx: 0, dy: 0, rot: 0, s: 1, sy: 1 },
    { dx: 0, dy: 0, rot: 0, s: 1, sy: 1 },
  ]
  private eyeScreen: [number, number, number][] = [
    [-0.3, -0.1, 1],
    [0.3, -0.1, 1],
  ]
  private moves: { name: MoveName; start: number; dur: number }[] = []
  private off = zeroKick()
  private offV = zeroKick()
  private lag: Vec2 = [0, 0]
  private lagV: Vec2 = [0, 0]
  private pp: Vec2 | null = null
  private pv: Vec2 = [0, 0]
  private gaze = { x: 0, y: 0 }
  private gazeV = { x: 0, y: 0 }
  private gazeTarget = { x: 0, y: 0 }
  private nextGlance = 0
  private blinkAt = -1
  private nextBlink = rand(1, 3)
  private particles: Particle[] = []
  private pokes: number[] = []
  private lastPoke = ""
  private lastActivity = 0
  private noticeUntil = 0
  private startleCool = 0
  private nextFidget = rand(3, 6)
  private level = 0
  private speaking = false
  private routineSpeak = false
  private ext = { v: 0, at: -10 }
  private sp = { on: false, t: 0, dur: 0.3, amp: 0, syl: 3, words: 4 }
  private bodyRGB: RGB = [255, 255, 255]
  private baseRGB: RGB = [255, 255, 255]
  private eyeCss = "#141414"
  private partCss: string | null = null

  constructor(opts: Partial<AvatarOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
    this.base = {
      [isEmotion(this.opts.emotion) ? this.opts.emotion : "idle"]: 1,
    }
    this.setTarget(this.base)
    this.shownDom = this.dom
    this.eyeShown = this.dom.eyes.map((e) => e.slice())
    this.refreshColors()
    this.bodyRGB = [...this.baseRGB]
  }

  /* ----- public API ----------------------------------------------------------------------------*/

  /** The emotion currently in charge (largest share of the mix). */
  get emotion(): EmotionName {
    return this.dom.name
  }
  /** Current blend, e.g. { happy: 0.7, excited: 0.3 }. */
  get mix(): EmotionMix {
    const o: EmotionMix = {}
    for (const m of this.members) if (m.n > 0.01) o[m.name] = +m.n.toFixed(3)
    return o
  }
  get routineProgress() {
    const r = this.routine
    if (!r) return 0
    if (r.shuffle) return r.el / r.steps[0].duration
    const total = r.steps.reduce((a, s) => a + s.duration, 0)
    let done = r.el
    for (let i = 0; i < r.idx; i++) done += r.steps[i].duration
    return done / total
  }

  /** Switch emotion. Stops any running loop unless keepRoutine. */
  setEmotion(name: EmotionName, { keepRoutine = false } = {}) {
    if (!isEmotion(name)) return this
    return this.setMix({ [name]: 1 }, { keepRoutine })
  }

  /** Blend emotions, e.g. { happy: 0.6, sleepy: 0.4 }. Weights are normalised. */
  setMix(mix: EmotionMix, { keepRoutine = false } = {}) {
    const m = normMix(mix)
    if (!m) return this
    if (!keepRoutine && this.routine) this.stop()
    this.base = m
    this.reactQueue = []
    this.notice()
    return this
  }

  /** Blend from the mood map: valence (-1 … 1) × arousal (-1 … 1). */
  setMood(valence: number, arousal: number, opts?: { keepRoutine?: boolean }) {
    this.mood = [clamp(valence, -1, 1), clamp(arousal, -1, 1)]
    return this.setMix(moodMix(valence, arousal), opts)
  }

  /** Briefly show emotions, then return: react("surprised", 1) or react([["surprised", .5], ["laughing", 1]]). */
  react(seq: EmotionName | [EmotionName, number][], duration?: number) {
    const list: [EmotionName, number][] =
      typeof seq === "string" ? [[seq, duration || 1.2]] : seq
    let at = this.t
    this.reactQueue = list
      .filter((s) => isEmotion(s[0]))
      .map(([name, d]) => ({ name, until: (at += d) }))
    this.lastActivity = this.t
    return this
  }

  /** One-shot move on top of the current loop. */
  gesture(name: GestureName) {
    if (!isGesture(name)) return this
    this.move(name)
    this.notice()
    return this
  }

  /** Play a loop: a routine name, "shuffle", or steps ("happy:2, spin, sad:3 talk" / array). */
  play(
    steps: RoutineName | "shuffle" | string | LoopStepInput[],
    { loop = true } = {}
  ) {
    let name = "custom"
    let input: string | LoopStepInput[] = steps
    if (typeof steps === "string" && steps in ROUTINES) {
      name = steps
      input = ROUTINE_DEFS[steps as RoutineName].steps
    }
    if (steps === "shuffle") {
      this.routine = {
        name: "shuffle",
        shuffle: true,
        loop: true,
        idx: 0,
        el: 0,
        steps: [],
      }
      this.shuffleStep()
    } else {
      const parsed = parseSteps(input)
      if (!parsed.length) return this
      this.routine = { name, steps: parsed, idx: 0, el: 0, loop }
    }
    this.reactQueue = []
    this.notice()
    this.applyStep()
    this.emit("routine", { name: this.routine.name, steps: this.routine.steps })
    return this
  }

  stop() {
    if (!this.routine) return this
    this.routine = null
    this.routineSpeak = false
    this.emit("routine", null)
    return this
  }

  /** Simulated talking: the body pulses like a mouth. */
  setSpeaking(on: boolean) {
    this.speaking = !!on
    return this
  }

  /**
   * Live audio level 0..1 (e.g. RMS from an AnalyserNode, every frame). Falls back to silence after
   * 300ms without updates unless `hold` is set; pass null to clear a held level.
   */
  setLevel(v: number | null, hold = false) {
    if (v === null) {
      this.ext.at = -10
      return this
    }
    this.ext.v = clamp(v)
    this.ext.at = hold ? Infinity : this.t
    return this
  }

  setColors({
    body,
    eyes,
    particle,
  }: {
    body?: string
    eyes?: string
    particle?: string | null
  }) {
    if (body) this.opts.body = body
    if (eyes) this.opts.eyes = eyes
    if (particle !== undefined) this.opts.particleColor = particle
    this.refreshColors()
    return this
  }

  set<K extends keyof AvatarOptions>(key: K, value: AvatarOptions[K]) {
    const old = this.opts[key]
    this.opts[key] = value
    if (key === "style" && old !== value)
      for (const m of this.members) this.fitMember(m)
    if (key === "alive" && !value) this.autoMood = null
    if (key === "body" || key === "eyes" || key === "particleColor")
      this.refreshColors()
    return this
  }

  /** Re-read colour options (call after a theme change). */
  refreshColors() {
    this.baseRGB = parseColor(this.colorResolver(this.opts.body))
    this.eyeCss = rgbStr(parseColor(this.colorResolver(this.opts.eyes)))
    this.partCss = this.opts.particleColor
      ? rgbStr(parseColor(this.colorResolver(this.opts.particleColor)))
      : null
  }

  /** Someone is around: resets boredom and wakes it. Hosts call this on pointer activity. */
  notice() {
    this.lastActivity = this.t
    if (this.autoMood) {
      const was = this.autoMood
      this.autoMood = null
      if (was === "sleepy") {
        this.react([["surprised", 0.6]])
        this.move("wake")
      } else this.move("glance")
    }
    return this
  }

  poke() {
    const sleeping = this.autoMood === "sleepy" || this.emotion === "sleepy"
    this.bumpV += 5
    this.pokes = this.pokes.filter((x) => this.t - x < 3)
    this.pokes.push(this.t)
    const n = this.pokes.length
    if (sleeping) {
      this.autoMood = null
      this.lastActivity = this.t
      this.react([
        ["surprised", 0.7],
        ["dizzy", 1.0],
      ])
      this.move("wake")
    } else if (n >= 6) {
      this.pokes = []
      this.react([["angry", 2.4]])
      this.move("huff")
    } else if (n >= 4) {
      this.react([["skeptical", 1.4]])
      this.move("shake")
    } else {
      const v = (EMOTION_DEFS[this.emotion].va ?? [0, 0])[0]
      const options =
        v < -0.3
          ? ["comfort", "shy"]
          : ["giggle", "spin", "wink", "hop", "shy", "giggle"]
      let r = pick(options)
      if (r === this.lastPoke) r = pick(options)
      this.lastPoke = r
      switch (r) {
        case "giggle":
          this.react([
            ["surprised", 0.35],
            ["laughing", 1.1],
          ])
          break
        case "spin":
          this.react([["happy", 1.3]])
          this.move("spin")
          break
        case "wink":
          this.react([["wink", 1.1]])
          this.move("tilt")
          break
        case "hop":
          this.react([["excited", 1.1]])
          this.move("hop")
          break
        case "shy":
          this.react([
            ["surprised", 0.3],
            ["shy", 1.8],
          ])
          break
        case "comfort":
          this.react([
            ["surprised", 0.35],
            ["love", 1.4],
          ])
          this.move("melt")
          break
      }
      this.lastActivity = this.t
    }
    this.emit("poke", undefined)
    return this
  }

  on<K extends keyof AvatarEvents>(evt: K, fn: Listener<K>) {
    const list = (this.listeners[evt] ??= []) as Listener<K>[]
    list.push(fn)
    return () => {
      this.listeners[evt] = list.filter((f) => f !== fn) as never
    }
  }

  /** True if (x, y) is on the body when drawn at (cx, cy) with radius R. */
  hit(x: number, y: number, cx: number, cy: number, R: number) {
    return (
      Math.hypot(x - (cx + this.pose.x * R), y - (cy + this.pose.y * R)) <
      R * this.pose.s * 1.05
    )
  }

  /* ----- internals -----------------------------------------------------------------------------*/

  private emit<K extends keyof AvatarEvents>(evt: K, data: AvatarEvents[K]) {
    const list = this.listeners[evt] as Listener<K>[] | undefined
    list?.forEach((f) => f(data))
  }

  private variant(name: EmotionName) {
    const v = variants()[name]
    return this.opts.style === "type" ? v.type : v.pill
  }
  // Point a member's eye shapes at the current style, matched to what's on screen.
  private fitMember(m: Member) {
    const v = this.variant(m.name)
    const shown = this.eyeShown
    m.eyes = shown
      ? v.eyes.map((e, i) => align(e, shown[i]))
      : v.eyes.map((e) => e.slice())
    m.topo = m.eyes.map(topology)
    m.fill = v.fill
  }

  private setTarget(mix: EmotionMix) {
    const key = mixKey(mix)
    if (key === this.effKey) return
    this.effKey = key
    for (const m of this.members) m.target = mix[m.name] ?? 0
    for (const name of Object.keys(mix) as EmotionName[]) {
      if (this.members.some((m) => m.name === name)) continue
      const def = EMOTION_DEFS[name]
      const target = mix[name] ?? 0
      const m: Member = {
        name,
        def,
        target,
        w: this.members.length ? 0 : target,
        n: 0,
        start: this.t,
        acc: (def.particles ?? []).map(() => 0),
        eyes: [],
        topo: [],
        fill: [],
      }
      this.fitMember(m)
      this.members.push(m)
    }
    const dom = this.members.reduce((a, b) => (b.target > a.target ? b : a))
    const old = this.dom as Member | undefined
    this.dom = dom
    if (old !== dom) this.dominantChanged(old, dom)
  }

  private dominantChanged(from: Member | undefined, to: Member) {
    const k = this.opts.intensity
    // A real switch (not sliding along a blend): follow-through and an in-between move.
    if (from && to.w < 0.05) {
      this.fitMember(to)
      const a = this.motionOf(from, k)
      const b = this.motionOf(to, k)
      for (const ch of KICK_KEYS) this.offV[ch] += (b[ch] - a[ch]) * 3.5
      const br = this.bridge(from.def, to)
      if (br) this.move(br)
      this.bumpV += 2 * k
    }
    this.nextGlance = this.t
    this.emit("emotion", to.name)
  }

  private bridge(from: EmotionDef, to: Member): MoveName | null {
    const fa = (from.va ?? [0, 0])[1]
    const [tv, ta] = to.def.va ?? [0, 0]
    if (to.name === "surprised" || to.name === "scared") return "startle"
    if (from === EMOTION_DEFS.sleepy && ta > -0.3) return "wake"
    if (to.name === "angry") return "huff"
    if (to.name === "love") return "melt"
    if (ta - fa > 0.45) return "pop"
    if (ta - fa < -0.45 || (tv < -0.4 && ta < 0.2)) return "sigh"
    if (
      to.name === "curious" ||
      to.name === "thinking" ||
      to.name === "skeptical"
    )
      return "tilt"
    return Math.random() < 0.5 ? "blink" : null
  }

  private move(name: MoveName) {
    this.moves = this.moves.filter((m) => m.name !== name)
    this.moves.push({ name, start: this.t, dur: MOVE_DEFS[name].dur })
  }
  private moveSum(k: number) {
    const out = {} as Record<MoveKey, number>
    for (const key of MOVE_KEYS) out[key] = 0
    this.moves = this.moves.filter((m) => this.t - m.start < m.dur)
    for (const m of this.moves) {
      const d = MOVE_DEFS[m.name]
      const o = d.f(clamp((this.t - m.start) / m.dur))
      const sc = d.fixed ? 1 : k
      for (const key of Object.keys(o) as MoveKey[])
        out[key] += (o[key] ?? 0) * sc
    }
    return out
  }

  private applyStep() {
    const r = this.routine
    if (!r) return
    const s = r.steps[r.idx]
    if (s.gesture) this.move(s.emotion as GestureName)
    else this.base = { [s.emotion]: 1 }
    this.routineSpeak = s.speak
    this.emit("step", { index: r.idx, step: s, total: r.steps.length })
  }
  private shuffleStep() {
    if (!this.routine) return
    const cur = Object.keys(this.base)[0]
    const names = EMOTION_NAMES.filter((n) => n !== cur && n !== "error")
    this.routine.steps = [
      {
        emotion: pick(names),
        duration: rand(2.2, 3.8),
        speak: Math.random() < 0.25,
        gesture: false,
      },
    ]
    this.routine.idx = 0
  }
  private routineTick(dt: number) {
    const r = this.routine
    if (!r) return
    r.el += dt
    if (r.el < r.steps[r.idx].duration) return
    r.el = 0
    if (r.shuffle) this.shuffleStep()
    else if (++r.idx >= r.steps.length) {
      if (!r.loop) {
        this.stop()
        return
      }
      r.idx = 0
    }
    this.applyStep()
  }

  private autonomy() {
    const t = this.t
    if (!this.opts.alive) {
      this.autoMood = null
      return
    }
    const calm =
      !this.routine && !this.reactQueue.length && this.base.idle === 1
    if (!calm) this.autoMood = null
    else {
      const quiet = t - this.lastActivity
      const want =
        quiet > this.opts.sleepAfter
          ? "sleepy"
          : quiet > this.opts.boredAfter
            ? "bored"
            : null
      if (want && want !== this.autoMood) {
        this.autoMood = want
        this.emit("auto", want)
      }
    }
    const a = this.attn
    if (a) {
      const d = Math.hypot(a.x, a.y)
      if (a.speed > 10 && d < 3 && t > this.startleCool) {
        this.startleCool = t + 6
        if (!this.reactQueue.length && !this.autoMood)
          this.react([["surprised", 0.5]])
        this.move("startle")
      } else if (a.speed > 1.2 && d < 7) this.noticeUntil = t + 1.5
    }
    if (t >= this.nextFidget) {
      const d = this.dom.def
      if (d.fidgets && !this.moves.length) this.move(pick(d.fidgets))
      this.nextFidget = t + rand(3.5, 8) / (d.fidgetRate ?? 1)
    }
  }

  private motionOf(m: Member, k: number): Pose {
    const p = basePose()
    return m.def.motion
      ? Object.assign(p, m.def.motion(this.t - m.start, k))
      : p
  }
  private eyeOf(m: Member, k: number, i: number): EyeAnim {
    const e = { dx: 0, dy: 0, rot: 0, s: 1, sy: 1 }
    return m.def.eye ? Object.assign(e, m.def.eye(this.t - m.start, k, i)) : e
  }

  private speech(dt: number) {
    let target = 0
    if (this.t - this.ext.at < 0.3) target = this.ext.v
    else if (this.speaking || this.routineSpeak) {
      const s = this.sp
      s.t += dt
      if (s.t >= s.dur) {
        s.t = 0
        if (s.on) {
          s.on = false
          if (--s.syl <= 0) {
            s.syl = randInt(2, 6)
            if (--s.words <= 0) {
              s.words = randInt(3, 8)
              s.dur = rand(0.45, 0.9)
            } else s.dur = rand(0.12, 0.26)
          } else s.dur = rand(0.02, 0.06)
        } else {
          s.on = true
          s.dur = rand(0.09, 0.2)
          s.amp = rand(0.45, 1)
        }
      }
      target = s.on ? s.amp * Math.sin((PI * s.t) / s.dur) : 0
    }
    const rate = target > this.level ? 28 : 11
    this.level += (target - this.level) * (1 - Math.exp(-dt * rate))
  }

  update(dt: number) {
    if (!(dt > 0)) return
    this.t += dt
    const t = this.t
    const k = this.opts.intensity

    this.routineTick(dt)
    while (this.reactQueue.length && t >= this.reactQueue[0].until)
      this.reactQueue.shift()
    this.autonomy()
    this.setTarget(
      this.reactQueue.length
        ? { [this.reactQueue[0].name]: 1 }
        : this.autoMood
          ? { [this.autoMood]: 1 }
          : this.base
    )

    // Mix weights ease toward their targets.
    const wr = 1 - Math.exp(-dt * 9)
    for (const m of this.members) m.w += (m.target - m.w) * wr
    this.members = this.members.filter((m) => m.target > 0 || m.w > 0.004)
    let W = 0
    for (const m of this.members) W += m.w
    let shown = this.members[0]
    for (const m of this.members) {
      m.n = m.w / W
      if (m.w > shown.w) shown = m
    }
    this.shownDom = shown
    const def = this.dom.def
    const tl = t - this.dom.start

    // Body pose: weighted blend of every active emotion's loop.
    const pose = basePose()
    for (const key of POSE_KEYS) pose[key] = 0
    for (const m of this.members) {
      const p = this.motionOf(m, k)
      for (const key of POSE_KEYS) pose[key] += p[key] * m.n
    }
    const mv = this.moveSum(k)
    pose.x += mv.x
    pose.y += mv.y
    pose.rot += mv.rot
    pose.yaw += mv.yaw
    pose.pitch += mv.pitch
    pose.sx *= 1 + mv.sx
    pose.sy *= 1 + mv.sy
    pose.s *= 1 + mv.s

    // Follow-through: a spring that overshoots after each switch.
    for (const ch of KICK_KEYS) {
      this.offV[ch] += (-81 * this.off[ch] - 7.2 * this.offV[ch]) * dt
      this.off[ch] += this.offV[ch] * dt
    }
    pose.x += this.off.x
    pose.y += this.off.y
    pose.rot += this.off.rot
    pose.yaw += this.off.yaw
    pose.pitch += this.off.pitch
    pose.s *= 1 + this.off.s

    // Talking: the whole body is the "mouth".
    this.speech(dt)
    const L = this.level
    pose.s *= 1 + L * 0.06 * k
    pose.sy *= 1 + L * 0.035 * k
    pose.sx *= 1 - L * 0.015 * k
    pose.y -= L * 0.02 * k

    // Springy squash impulse.
    this.bumpV += (-190 * this.bump - 11 * this.bumpV) * dt
    this.bump += this.bumpV * dt
    const b = clamp(this.bump, -0.25, 0.25)
    pose.sx *= 1 + b
    pose.sy *= 1 - b
    this.pose = pose

    // Secondary motion: the eyes are a little loose and lag behind the body.
    if (this.pp) {
      const vx = (pose.x - this.pp[0]) / dt
      const vy = (pose.y - this.pp[1]) / dt
      let ax = (vx - this.pv[0]) / dt
      let ay = (vy - this.pv[1]) / dt
      const am = Math.hypot(ax, ay)
      if (am > 80) {
        ax *= 80 / am
        ay *= 80 / am
      }
      this.pv = [vx, vy]
      for (let a = 0; a < 2; a++) {
        this.lagV[a] +=
          (-256 * this.lag[a] - 11.2 * this.lagV[a] - (a ? ay : ax) * 1.4) * dt
        this.lag[a] = clamp(this.lag[a] + this.lagV[a] * dt, -0.07, 0.07)
      }
    }
    this.pp = [pose.x, pose.y]

    // Gaze: a slightly underdamped spring, so glances overshoot and settle.
    let target: Vec2
    const follow =
      this.lookAt ??
      (this.opts.alive && this.attn && t < this.noticeUntil
        ? ([this.attn.x, this.attn.y] as Vec2)
        : null)
    if (follow && !def.lockGaze)
      target = [Math.tanh(follow[0] / 2.2), Math.tanh(follow[1] / 2.2)]
    else if (typeof def.gaze === "function") target = def.gaze(tl, k)
    else if (def.gaze) target = def.gaze
    else {
      if (t >= this.nextGlance) {
        const w = def.wander ?? { range: 0.5, every: [1, 3] as Vec2 }
        const bias = w.bias ?? [0, 0]
        const home = Math.random() < 0.35
        this.gazeTarget = home
          ? { x: bias[0], y: bias[1] }
          : {
              x: bias[0] + rand(-1, 1) * w.range,
              y: bias[1] + rand(-1, 1) * w.range * 0.6,
            }
        this.nextGlance = t + rand(w.every[0], w.every[1])
      }
      target = [this.gazeTarget.x, this.gazeTarget.y]
    }
    this.gazeV.x +=
      (400 * (clamp(target[0], -1, 1) - this.gaze.x) - 24.8 * this.gazeV.x) * dt
    this.gaze.x += this.gazeV.x * dt
    this.gazeV.y +=
      (400 * (clamp(target[1], -1, 1) - this.gaze.y) - 24.8 * this.gazeV.y) * dt
    this.gaze.y += this.gazeV.y * dt
    this.head.yaw = this.gaze.x * 0.85 + pose.yaw
    this.head.pitch = this.gaze.y * 0.42 + pose.pitch

    // Blinking.
    let blink = 1
    if (this.opts.blink && def.blink) {
      if (t >= this.nextBlink && this.blinkAt < 0) {
        this.blinkAt = t
        this.nextBlink = t + (Math.random() < 0.2 ? 0.28 : rand(2, 5.5))
      }
      if (this.blinkAt >= 0) {
        const bp = (t - this.blinkAt) / 0.17
        if (bp >= 1) this.blinkAt = -1
        else blink = 1 - Math.sin(PI * bp) * 0.88
      }
    } else this.blinkAt = -1

    // Per-eye animation (blended), plus lag, speech pop and move squints.
    const cr = Math.cos(-pose.rot)
    const sr = Math.sin(-pose.rot)
    const lx = this.lag[0] * cr - this.lag[1] * sr
    const ly = this.lag[0] * sr + this.lag[1] * cr
    for (let i = 0; i < 2; i++) {
      const e: EyeAnim = { dx: 0, dy: 0, rot: 0, s: 0, sy: 0 }
      let rc = 0
      let rs = 0
      for (const m of this.members) {
        const a = this.eyeOf(m, k, i)
        e.dx += a.dx * m.n
        e.dy += a.dy * m.n
        e.s += a.s * m.n
        e.sy += a.sy * m.n
        rc += Math.cos(a.rot) * m.n
        rs += Math.sin(a.rot) * m.n
      }
      e.rot = Math.atan2(rs, rc)
      e.sy *= blink * (1 + L * 0.12) * Math.max(0.06, 1 + mv.eyeSy)
      e.s *= 1 + mv.eyeS
      e.dx += lx
      e.dy += ly - L * 0.025
      this.eyeT[i] = e
    }

    // Eye shapes: blend of every member's aligned glyph, followed by a springy morph.
    const shownEyes = this.eyeShown as EyeShape[]
    for (let i = 0; i < 2; i++) {
      const tg = this.tgt[i].fill(0)
      const s = shownEyes[i]
      const v = this.eyeVel[i]
      for (const m of this.members) {
        const e = m.eyes[i]
        for (let q = 0; q < EYE_LEN; q++) tg[q] += e[q] * m.n
      }
      for (let q = 0; q < EYE_LEN; q++) {
        v[q] += (900 * (tg[q] - s[q]) - 25 * v[q]) * dt
        s[q] += v[q] * dt
      }
    }

    // Body colour.
    const cs = 1 - Math.exp(-dt * 5)
    const tc: RGB = [0, 0, 0]
    for (const m of this.members) {
      const c =
        this.opts.moodTint && m.def.tint ? parseColor(m.def.tint) : this.baseRGB
      for (let i = 0; i < 3; i++) tc[i] += c[i] * m.n
    }
    for (let i = 0; i < 3; i++)
      this.bodyRGB[i] += (tc[i] - this.bodyRGB[i]) * cs

    // Particles.
    if (this.opts.particles) {
      for (const m of this.members) {
        ;(m.def.particles ?? []).forEach((em, i) => {
          m.acc[i] += dt * m.n
          if (m.acc[i] >= em.every) {
            m.acc[i] -= em.every
            ;([] as ParticleSpec[])
              .concat(em.spawn())
              .forEach((p) => this.spawn(p))
          }
        })
      }
    }
    for (const p of this.particles) {
      p.age += dt
      if (p.age < p.delay) continue
      if (p.orbit) {
        p.orbit.a += p.orbit.va * dt
        p.x = this.pose.x + Math.cos(p.orbit.a) * p.orbit.rx
        p.y = this.pose.y + p.orbit.cy + Math.sin(p.orbit.a) * p.orbit.ry
      } else {
        p.vy += p.g * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
      }
      p.rot += p.vr * dt
    }
    this.particles = this.particles.filter((p) => p.age < p.delay + p.life)
  }

  private spawn(spec: ParticleSpec) {
    if (this.particles.length > 80) return
    const q: Particle = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      g: 0,
      life: 1,
      age: 0,
      delay: 0,
      size: 0.1,
      grow: 0,
      rot: 0,
      vr: 0,
      onBody: false,
      ...spec,
    }
    if (q.fromEye) {
      const seen = this.eyeScreen.filter((c) => c[2] > 0.25)
      if (!seen.length) return
      const c = pick(seen)
      q.x = c[0]
      q.y = c[1] + 0.12
    }
    if (!q.onBody && !q.orbit) {
      q.x += this.pose.x
      q.y += this.pose.y
    }
    this.particles.push(q)
  }

  /** Draw at (cx, cy) with body radius R, in the context's current coordinate space. */
  draw(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    R: number,
    { shadow = this.opts.shadow } = {}
  ) {
    const p = this.pose
    const style = STYLES[this.opts.style] ?? STYLES.pill

    let body = rgbStr(this.bodyRGB)
    let eye = this.eyeCss
    let jx = 0
    let jy = 0
    if (p.glitch > 0 && Math.random() < p.glitch) {
      ;[body, eye] = [eye, body]
      jx = rand(-0.07, 0.07)
      jy = rand(-0.02, 0.02)
    }
    const partColor = this.partCss ?? body
    const bx = cx + (p.x + jx) * R
    const by = cy + (p.y + jy) * R

    if (shadow) {
      const lift = clamp(-p.y * 5)
      ctx.save()
      ctx.globalAlpha = 0.14 * (1 - lift * 0.6)
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.ellipse(
        cx + p.x * R,
        cy + R * 1.16,
        R * 0.62 * p.s * (1 - lift * 0.35) * p.sx,
        R * 0.07,
        0,
        0,
        TAU
      )
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    ctx.translate(bx, by)
    ctx.rotate(p.rot)
    ctx.scale(p.sx * p.s * R, p.sy * p.s * R)
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, TAU)
    ctx.fill()

    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, TAU)
    ctx.clip() // eyes wrap round the edge, never past it
    ctx.strokeStyle = eye
    ctx.fillStyle = eye
    ctx.lineCap = style.cap
    ctx.lineJoin = style.join
    ctx.miterLimit = 6
    this.drawEyes(ctx, style.weight)
    for (const q of this.particles) if (q.onBody) this.drawParticle(ctx, q, eye)
    ctx.restore()
    ctx.restore()

    for (const q of this.particles) {
      if (q.onBody) continue
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(R, R)
      this.drawParticle(ctx, q, partColor)
      ctx.restore()
    }
  }

  // Eyes are decals on the unit sphere: every point is wrapped onto the surface around the eye's
  // centre, rotated with the head, and anything on the far side is cut at the silhouette.
  private drawEyes(ctx: CanvasRenderingContext2D, weight: number) {
    const cyw = Math.cos(this.head.yaw)
    const syw = Math.sin(this.head.yaw)
    const cp = Math.cos(this.head.pitch)
    const sp = Math.sin(this.head.pitch)
    const rot3 = (x: number, y: number, z: number, o: number[]) => {
      const x1 = x * cyw + z * syw
      const z1 = -x * syw + z * cyw
      o[0] = x1
      o[1] = y * cp + z1 * sp
      o[2] = -y * sp + z1 * cp
    }
    const C = [0, 0, 0]
    const E = [0, 0, 0]
    const S = [0, 0, 0]
    const proj = this.proj
    const src = this.shownDom
    const shownEyes = this.eyeShown as EyeShape[]
    for (let i = 0; i < 2; i++) {
      const e = this.eyeT[i]
      const side = i ? 1 : -1
      const lon = side * 0.33 + e.dx
      const lat = -0.1 + e.dy
      const cl = Math.cos(lat)
      const sl = Math.sin(lat)
      const co = Math.cos(lon)
      const so = Math.sin(lon)
      rot3(so * cl, sl, co * cl, C)
      rot3(co, 0, -so, E)
      rot3(-so * sl, cl, -co * sl, S)
      this.eyeScreen[i] = [C[0], C[1], C[2]]
      if (C[2] < -0.75) continue // well round the back

      // Wrap every point onto the sphere (exponential map around the eye centre).
      const es = e.s * EYE_SCALE
      const esy = es * e.sy
      const er = Math.cos(e.rot)
      const sr = Math.sin(e.rot)
      const sh = shownEyes[i]
      for (let j = 0; j < NS; j++)
        for (let k = 0; k < N; k++) {
          const x = sh[j * ST + 2 * k]
          const y = sh[j * ST + 2 * k + 1]
          const o = (j * N + k) * 3
          const u = (x * er - y * sr) * es
          const v = (x * sr + y * er) * esy
          const r = Math.hypot(u, v)
          if (r < 1e-7) {
            proj[o] = C[0]
            proj[o + 1] = C[1]
            proj[o + 2] = C[2]
            continue
          }
          const c = Math.cos(r)
          const sn = Math.sin(r) / r
          proj[o] = C[0] * c + (E[0] * u + S[0] * v) * sn
          proj[o + 1] = C[1] * c + (E[1] * u + S[1] * v) * sn
          proj[o + 2] = C[2] * c + (E[2] * u + S[2] * v) * sn
        }

      // Pen squashed toward the silhouette, so strokes thin out as they turn edge-on.
      let m00 = 1
      let m01 = 0
      let m11 = 1
      let i00 = 1
      let i01 = 0
      let i11 = 1
      const rr = Math.hypot(C[0], C[1])
      if (rr > 1e-4) {
        const mx = C[0] / rr
        const my = C[1] / rr
        const f = clamp(Math.abs(C[2]), 0.08, 1)
        const g = 1 - f
        const h = 1 / f - 1
        m00 = 1 - g * mx * mx
        m01 = -g * mx * my
        m11 = 1 - g * my * my
        i00 = 1 + h * mx * mx
        i01 = h * mx * my
        i11 = 1 + h * my * my
      }
      ctx.save()
      ctx.transform(m00, m01, m01, m11, 0, 0)
      const mt = (x: number, y: number) =>
        ctx.moveTo(i00 * x + i01 * y, i01 * x + i11 * y)
      const lt = (x: number, y: number) =>
        ctx.lineTo(i00 * x + i01 * y, i01 * x + i11 * y)
      const limb = (
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        fn: typeof mt
      ) => {
        const f = az / (az - bz)
        const qx = ax + (bx - ax) * f
        const qy = ay + (by - ay) * f
        const l = Math.hypot(qx, qy) || 1
        fn(qx / l, qy / l)
      }
      const fill = src.fill[i]
      const run = (entries: ChainEntry[], closed: boolean) => {
        let open = false
        let hidden = false
        let first = true
        let px = 0
        let py = 0
        let pz = 1
        ctx.beginPath()
        for (const en of entries)
          for (let a = 0; a < N; a++) {
            const o = (en.j * N + (en.rev ? N - 1 - a : a)) * 3
            const x = proj[o]
            const y = proj[o + 1]
            const z = proj[o + 2]
            if (z > 0) {
              if (open) lt(x, y)
              else if (!first && pz <= 0) {
                limb(px, py, pz, x, y, z, mt)
                lt(x, y)
                open = true
              } else {
                mt(x, y)
                open = true
              }
            } else {
              hidden = true
              if (open) {
                limb(px, py, pz, x, y, z, lt)
                open = false
              }
            }
            px = x
            py = y
            pz = z
            first = false
          }
        if (closed && !hidden) {
          ctx.closePath()
          if (fill) ctx.fill()
        }
        ctx.stroke()
      }
      const topo = src.topo[i]
      for (const ch of topo.chains) {
        const w = sh[ch.entries[0].j * ST + 2 * N] * es * weight
        if (w < 0.004) continue
        ctx.lineWidth = w
        run(ch.entries, ch.closed)
      }
      for (const j of topo.dots) {
        const w = sh[j * ST + 2 * N] * es
        if (w < 0.004) continue
        if (strokeLen(sh, j) * es < 0.01) {
          const o = (j * N + (N >> 1)) * 3
          if (proj[o + 2] <= 0) continue
          ctx.beginPath()
          ctx.arc(
            i00 * proj[o] + i01 * proj[o + 1],
            i01 * proj[o] + i11 * proj[o + 1],
            w / 2,
            0,
            TAU
          )
          ctx.fill()
        } else {
          ctx.lineWidth = w * weight
          run([{ j, rev: false }], false)
        }
      }
      ctx.restore()
    }
  }

  private drawParticle(
    ctx: CanvasRenderingContext2D,
    q: Particle,
    color: string
  ) {
    if (q.age < q.delay) return
    const a = (q.age - q.delay) / q.life
    const alpha = Math.min(1, a / 0.15) * Math.min(1, (1 - a) / 0.35)
    const pop = a < 0.18 ? easeOutBack(a / 0.18) : 1
    const sz = q.size * (1 + q.grow * a) * pop
    if (sz <= 0 || alpha <= 0) return
    ctx.save()
    ctx.globalAlpha = clamp(alpha)
    ctx.translate(q.x, q.y)
    ctx.rotate(q.rot)
    ctx.scale(sz, sz)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 0.38
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    switch (q.type) {
      case "z":
        ctx.moveTo(-0.8, -0.8)
        ctx.lineTo(0.8, -0.8)
        ctx.lineTo(-0.8, 0.8)
        ctx.lineTo(0.8, 0.8)
        ctx.stroke()
        break
      case "heart":
        ctx.moveTo(0, 0.85)
        ctx.bezierCurveTo(-1.3, 0, -1.1, -1.2, 0, -0.45)
        ctx.bezierCurveTo(1.1, -1.2, 1.3, 0, 0, 0.85)
        ctx.fill()
        break
      case "spark":
        ctx.moveTo(0, -1)
        ctx.lineTo(0, 1)
        ctx.moveTo(-1, 0)
        ctx.lineTo(1, 0)
        ctx.stroke()
        break
      case "dot":
        ctx.arc(0, 0, 1, 0, TAU)
        ctx.fill()
        break
      case "puff":
        ctx.lineWidth = 0.3
        ctx.arc(0, 0, 1, 0, TAU)
        ctx.stroke()
        break
      case "tear":
      case "drop":
        ctx.moveTo(0, -1.4)
        ctx.lineTo(0.62, 0.05)
        ctx.arc(0, 0.25, 0.65, -0.3, PI + 0.3)
        ctx.closePath()
        ctx.fill()
        break
      case "q":
        ctx.arc(0, -0.45, 0.45, PI, PI * 2.5)
        ctx.lineTo(0, 0.25)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0.75, 0.2, 0, TAU)
        ctx.fill()
        break
    }
    ctx.restore()
  }
}

/* -------------------------------------------------------------------------------------------------
 * Canvas hosts
 * -----------------------------------------------------------------------------------------------*/

type Host = { frame: (dt: number) => void }

// One requestAnimationFrame loop for every avatar on the page.
const Ticker = {
  hosts: new Set<Host>(),
  last: 0,
  running: false,
  add(h: Host) {
    this.hosts.add(h)
    if (!this.running) {
      this.running = true
      this.last = performance.now()
      requestAnimationFrame(Ticker.loop)
    }
  },
  remove(h: Host) {
    this.hosts.delete(h)
  },
  loop(now: number) {
    const dt = Math.min(0.05, Math.max(0, (now - Ticker.last) / 1000))
    Ticker.last = now
    for (const h of Ticker.hosts) h.frame(dt)
    if (Ticker.hosts.size) requestAnimationFrame(Ticker.loop)
    else Ticker.running = false
  },
}

// Shared plumbing: backing-store sizing, pausing offscreen, re-reading theme colours.
class CanvasSurface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w = 1
  h = 1
  dpr = 1
  visible = true
  private cw = -1
  private ch = -1
  private cleanups: (() => void)[] = []

  constructor(canvas: HTMLCanvasElement, onTheme: () => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d") as CanvasRenderingContext2D
    this.fit()
    const ro = new ResizeObserver(() => this.fit())
    ro.observe(canvas)
    const io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting)
    })
    io.observe(canvas)
    // Theme tokens change when a class/style/data-theme flips on <html> (e.g. dark mode).
    const mo = new MutationObserver(onTheme)
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    })
    const mq = matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener("change", onTheme)
    this.cleanups.push(
      () => ro.disconnect(),
      () => io.disconnect(),
      () => mo.disconnect(),
      () => mq.removeEventListener("change", onTheme)
    )
  }

  fit() {
    const r = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.w = Math.max(1, r.width)
    this.h = Math.max(1, r.height)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.cw = this.canvas.clientWidth
    this.ch = this.canvas.clientHeight
  }
  // Belt and braces for ResizeObserver.
  checkSize() {
    if (
      this.canvas.clientWidth !== this.cw ||
      this.canvas.clientHeight !== this.ch
    )
      this.fit()
  }
  clear() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ctx.clearRect(0, 0, this.w, this.h)
  }
  resolve = (value: string) => resolveCssColor(this.canvas, value)
  onCleanup(fn: () => void) {
    this.cleanups.push(fn)
  }
  destroy() {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }
}

/** One face filling a canvas. */
class AvatarCanvas extends AvatarFace {
  readonly surface: CanvasSurface
  private pointer: { x: number; y: number } | null = null
  private prevLocal: Vec2 | null = null
  private pspeed = 0
  private host: Host = { frame: (dt) => this.frame(dt) }

  constructor(canvas: HTMLCanvasElement, opts: Partial<AvatarOptions> = {}) {
    super(opts)
    this.surface = new CanvasSurface(canvas, () => this.refreshColors())
    this.colorResolver = this.surface.resolve
    this.refreshColors()

    const onMove = (e: PointerEvent) => {
      this.pointer = { x: e.clientX, y: e.clientY }
      if (this.opts.interactive) {
        this.notice()
        canvas.style.cursor = this.hitClient(e.clientX, e.clientY)
          ? "pointer"
          : ""
      }
    }
    const onDown = (e: PointerEvent) => {
      if (this.opts.interactive && this.hitClient(e.clientX, e.clientY))
        this.poke()
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    canvas.addEventListener("pointerdown", onDown)
    this.surface.onCleanup(() => {
      window.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerdown", onDown)
    })
    Ticker.add(this.host)
  }

  destroy() {
    Ticker.remove(this.host)
    this.surface.destroy()
  }

  private geom() {
    const { w, h } = this.surface
    const R = Math.min(w, h) * this.opts.size
    return { R, cx: w / 2, cy: h / 2 + R * 0.06 }
  }
  private hitClient(clientX: number, clientY: number) {
    const rect = this.surface.canvas.getBoundingClientRect()
    const { R, cx, cy } = this.geom()
    return this.hit(clientX - rect.left, clientY - rect.top, cx, cy, R)
  }

  private frame(dt: number) {
    const s = this.surface
    if (!s.canvas.isConnected || !s.visible) return
    s.checkSize()
    const { R, cx, cy } = this.geom()
    this.lookAt = null
    this.attn = null
    if (this.pointer && this.opts.interactive) {
      const rect = s.canvas.getBoundingClientRect()
      const local: Vec2 = [
        (this.pointer.x - rect.left - cx) / R,
        (this.pointer.y - rect.top - cy) / R,
      ]
      if (this.prevLocal && dt > 0) {
        const sp =
          Math.hypot(
            local[0] - this.prevLocal[0],
            local[1] - this.prevLocal[1]
          ) / dt
        this.pspeed += (sp - this.pspeed) * 0.5
      }
      this.prevLocal = local
      this.attn = { x: local[0], y: local[1], speed: this.pspeed }
      if (this.opts.lookAtPointer) this.lookAt = local
    }
    this.update(dt)
    s.clear()
    this.draw(s.ctx, cx, cy, R)
  }
}

const CROWD_PALETTE: [string, string][] = [
  ["#8b4cf0", "#0d0d0d"],
  ["#ff7a1f", "#0d0d0d"],
  ["#10b04f", "#0d0d0d"],
  ["#0066ff", "#0d0d0d"],
  ["#e2e2e2", "#0d0d0d"],
  ["#2b2b2b", "#ffffff"],
  ["#ffffff", "#141414"],
  ["#ff5d8f", "#0d0d0d"],
]

type CrowdOptions = {
  count: number
  palette: [string, string][]
  style: EyeStyle
  intensity: number
  lookAtPointer: boolean
  alive: boolean
  particles: boolean
  moodTint: boolean
}
type CrowdMember = {
  face: AvatarFace
  r: number
  x: number
  y: number
  vx: number
  vy: number
  focus: CrowdMember | null
  nextFocus: number
  cool: number
}

/** A room of drifting, bumping dots, each with its own mood. */
class AvatarCrowdCanvas {
  readonly surface: CanvasSurface
  opts: CrowdOptions
  members: CrowdMember[] = []
  onSelect: ((face: AvatarFace) => void) | null = null
  private pointer: { x: number; y: number } | null = null
  private host: Host = { frame: (dt) => this.frame(dt) }

  constructor(canvas: HTMLCanvasElement, opts: Partial<CrowdOptions> = {}) {
    this.opts = {
      count: 7,
      palette: CROWD_PALETTE,
      style: "type",
      intensity: 1,
      lookAtPointer: true,
      alive: true,
      particles: true,
      moodTint: false,
      ...opts,
    }
    this.surface = new CanvasSurface(canvas, () =>
      this.faces.forEach((f) => f.refreshColors())
    )
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top }
      canvas.style.cursor = this.at(this.pointer.x, this.pointer.y)
        ? "pointer"
        : ""
      this.faces.forEach((f) => f.notice())
    }
    const onLeave = () => {
      this.pointer = null
    }
    const onDown = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const m = this.at(x, y)
      if (!m) return
      m.face.poke()
      const d = Math.hypot(m.x - x, m.y - y) || 1
      m.vx += ((m.x - x) / d) * 160
      m.vy += ((m.y - y) / d) * 160
      this.onSelect?.(m.face)
    }
    canvas.addEventListener("pointermove", onMove, { passive: true })
    canvas.addEventListener("pointerleave", onLeave)
    canvas.addEventListener("pointerdown", onDown)
    this.surface.onCleanup(() => {
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("pointerdown", onDown)
    })
    this.setCount(this.opts.count)
    Ticker.add(this.host)
  }

  get faces() {
    return this.members.map((m) => m.face)
  }

  setCount(n: number) {
    const { w, h } = this.surface
    while (this.members.length > n) this.members.pop()
    // Size dots from the area, so a wide, short strip still gets decent-sized dots.
    const S = Math.min(Math.min(w, h) * 1.2, Math.sqrt(w * h) * 0.75) || 400
    while (this.members.length < n) {
      const i = this.members.length
      const [body, eyes] = this.opts.palette[i % this.opts.palette.length]
      const face = new AvatarFace({
        body,
        eyes,
        style: this.opts.style,
        intensity: this.opts.intensity,
        alive: this.opts.alive,
        particles: this.opts.particles,
        moodTint: this.opts.moodTint,
        shadow: false,
      })
      face.colorResolver = this.surface.resolve
      face.refreshColors()
      face.t = rand(0, 10)
      face.play("shuffle")
      if (face.routine) face.routine.el = rand(0, 2)
      const k = rand(0.35, 1)
      const r = S * (0.04 + 0.095 * k * k)
      this.members.push({
        face,
        r,
        x: rand(r, Math.max(r + 1, w - r)),
        y: rand(r, Math.max(r + 1, h - r)),
        vx: rand(-30, 30),
        vy: rand(-30, 30),
        focus: null,
        nextFocus: 0,
        cool: 0,
      })
    }
    this.members.sort((a, b) => b.r - a.r)
    return this
  }
  set<K extends keyof CrowdOptions>(key: K, value: CrowdOptions[K]) {
    this.opts[key] = value
    if (key === "count") this.setCount(value as number)
    else if (
      key === "style" ||
      key === "intensity" ||
      key === "alive" ||
      key === "particles" ||
      key === "moodTint"
    )
      this.faces.forEach((f) => f.set(key, value as never))
    return this
  }
  setEmotion(name: EmotionName) {
    this.faces.forEach((f) => f.setEmotion(name))
    return this
  }
  setMood(v: number, a: number) {
    this.faces.forEach((f) => f.setMood(v, a))
    return this
  }
  gesture(name: GestureName) {
    this.faces.forEach((f) => f.gesture(name))
    return this
  }
  play(steps: RoutineName | "shuffle" | string | LoopStepInput[]) {
    this.faces.forEach((f, i) => {
      f.play(steps)
      if (f.routine && steps !== "shuffle") f.routine.el = i * 0.15
    })
    return this
  }
  stop() {
    this.faces.forEach((f) => f.stop())
    return this
  }
  setSpeaking(on: boolean) {
    this.faces.forEach((f) => f.setSpeaking(on))
    return this
  }
  destroy() {
    Ticker.remove(this.host)
    this.surface.destroy()
  }

  private at(x: number, y: number) {
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i]
      if (m.face.hit(x, y, m.x, m.y, m.r)) return m
    }
    return null
  }

  private frame(dt: number) {
    const s = this.surface
    if (!s.canvas.isConnected || !s.visible) return
    s.checkSize()
    const ms = this.members
    const W = s.w
    const H = s.h
    for (const m of ms) {
      // Wander at a gentle cruising speed.
      m.vx += rand(-1, 1) * 40 * dt
      m.vy += rand(-1, 1) * 40 * dt
      const sp = Math.hypot(m.vx, m.vy)
      const f = 1 + (26 / Math.max(sp, 1) - 1) * Math.min(1, dt * 0.8)
      m.vx *= f
      m.vy *= f
      m.x += m.vx * dt
      m.y += m.vy * dt
      // Soft walls: dots may hang off the edge a little.
      const pad = m.r * 0.55
      if (m.x < pad) m.vx += (pad - m.x) * 6 * dt
      if (m.x > W - pad) m.vx -= (m.x - (W - pad)) * 6 * dt
      if (m.y < pad) m.vy += (pad - m.y) * 6 * dt
      if (m.y > H - pad) m.vy -= (m.y - (H - pad)) * 6 * dt
      m.cool -= dt
    }
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i]
        const b = ms[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const min = a.r + b.r + 6
        if (d >= min) continue
        const nx = dx / d
        const ny = dy / d
        const push = (min - d) / 2
        const ma = a.r * a.r
        const mb = b.r * b.r
        a.x -= nx * push * (mb / (ma + mb)) * 2
        a.y -= ny * push * (mb / (ma + mb)) * 2
        b.x += nx * push * (ma / (ma + mb)) * 2
        b.y += ny * push * (ma / (ma + mb)) * 2
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (rv < 0) {
          const imp = (-1.8 * rv) / (1 / ma + 1 / mb)
          a.vx -= (imp / ma) * nx
          a.vy -= (imp / ma) * ny
          b.vx += (imp / mb) * nx
          b.vy += (imp / mb) * ny
          for (const [m, o] of [
            [a, b],
            [b, a],
          ]) {
            m.face.bumpV += clamp(-rv / 40, 0, 4)
            m.focus = o
            m.nextFocus = m.face.t + 1.5
            if (-rv > 45 && m.cool <= 0) {
              m.cool = 3
              m.face.react(
                pick(["surprised", "skeptical", "angry", "laughing"] as const),
                1.1
              )
            }
          }
        }
      }
    for (const m of ms) {
      if (m.face.t >= m.nextFocus) {
        m.focus = Math.random() < 0.5 ? pick(ms.filter((o) => o !== m)) : null
        m.nextFocus = m.face.t + rand(1.5, 4)
      }
      let tx: number | null = null
      let ty = 0
      if (
        this.opts.lookAtPointer &&
        this.pointer &&
        Math.hypot(this.pointer.x - m.x, this.pointer.y - m.y) <
          Math.max(W, H) * 0.35
      ) {
        tx = this.pointer.x
        ty = this.pointer.y
      } else if (m.focus) {
        tx = m.focus.x
        ty = m.focus.y
      }
      m.face.lookAt = tx === null ? null : [(tx - m.x) / m.r, (ty - m.y) / m.r]
      m.face.update(dt)
    }
    s.clear()
    for (const m of ms) m.face.draw(s.ctx, m.x, m.y, m.r, { shadow: false })
  }
}

/* -------------------------------------------------------------------------------------------------
 * React
 * -----------------------------------------------------------------------------------------------*/

// Returns the previous reference while the value is structurally equal, so array/object props
// written inline don't retrigger effects every render.
function useStable<T>(value: T): T {
  const key = value === undefined ? "" : JSON.stringify(value)
  return React.useMemo(
    () => (key === "" ? undefined : JSON.parse(key)) as T,
    [key]
  )
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"
function subscribeReducedMotion(cb: () => void) {
  const mq = matchMedia(REDUCED_MOTION)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia(REDUCED_MOTION).matches,
    () => false
  )
}

type EmotiveAvatarHandle = {
  setEmotion: (name: EmotionName) => void
  setMix: (mix: EmotionMix) => void
  setMood: (valence: number, arousal: number) => void
  /** Briefly show emotions, then return to the current one. */
  react: (seq: EmotionName | [EmotionName, number][], duration?: number) => void
  gesture: (name: GestureName) => void
  play: (
    steps: RoutineName | "shuffle" | string | LoopStepInput[],
    options?: { loop?: boolean }
  ) => void
  stop: () => void
  poke: () => void
  /** Live audio level 0..1. Call every frame; it falls silent 300ms after the last call. */
  setLevel: (level: number) => void
  setSpeaking: (on: boolean) => void
  readonly emotion: EmotionName
  readonly mix: EmotionMix
  /** The underlying engine, for anything not covered above. */
  readonly engine: AvatarCanvas | null
}

type EmotiveAvatarProps = Omit<
  React.ComponentProps<"div">,
  "children" | "ref"
> & {
  ref?: React.Ref<EmotiveAvatarHandle>
  /** Base emotion. Ignored while `mix`, `mood` or `loop` is set. */
  emotion?: EmotionName
  /** Blend of emotions, e.g. { happy: 0.7, sleepy: 0.3 }. */
  mix?: EmotionMix
  /** [valence, arousal], each -1..1. Blends the nearest emotions on the mood map. */
  mood?: Vec2
  /** Built-in routine, "shuffle", or steps like "happy:2, spin, sad:3 talk". Takes priority. */
  loop?: RoutineName | "shuffle" | string | LoopStepInput[]
  /** Repeat the loop. Default true. */
  loopRepeat?: boolean
  /** Simulated talking. */
  speaking?: boolean
  /** Held audio level 0..1. For live audio, call `ref.setLevel()` every frame instead. */
  level?: number
  eyeStyle?: EyeStyle
  /** Body colour; any CSS colour. Defaults to the theme's foreground. */
  body?: string
  /** Eye colour. Defaults to the theme's background. */
  eyes?: string
  particleColor?: string
  /** Motion amplitude, 0–2. */
  intensity?: number
  /** Body radius as a fraction of the element's short side. */
  size?: number
  alive?: boolean
  lookAtPointer?: boolean
  moodTint?: boolean
  particles?: boolean
  shadow?: boolean
  blink?: boolean
  /** Clickable, and aware of the pointer. */
  interactive?: boolean
  boredAfter?: number
  sleepAfter?: number
  /** "user" (default) tones motion down when the OS asks for reduced motion. */
  reducedMotion?: "user" | "never"
  /** Accessible name. The current emotion is appended. */
  label?: string
  onEmotionChange?: (emotion: EmotionName) => void
  onPoke?: () => void
  onStep?: (step: LoopStep, index: number) => void
  onAutoChange?: (state: "bored" | "sleepy") => void
}

function EmotiveAvatar({
  ref,
  emotion = "idle",
  mix,
  mood,
  loop,
  loopRepeat = true,
  speaking = false,
  level,
  eyeStyle = "pill",
  body = "var(--foreground)",
  eyes = "var(--background)",
  particleColor,
  intensity = 1,
  size = 0.32,
  alive = true,
  lookAtPointer = false,
  moodTint = false,
  particles = true,
  shadow = false,
  blink = true,
  interactive = true,
  boredAfter = 20,
  sleepAfter = 45,
  reducedMotion = "user",
  label = "Avatar",
  onEmotionChange,
  onPoke,
  onStep,
  onAutoChange,
  className,
  ...props
}: EmotiveAvatarProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const engineRef = React.useRef<AvatarCanvas | null>(null)
  const [current, setCurrent] = React.useState<EmotionName>(emotion)
  const reduced = usePrefersReducedMotion() && reducedMotion === "user"

  const callbacks = React.useRef({
    onEmotionChange,
    onPoke,
    onStep,
    onAutoChange,
  })
  React.useEffect(() => {
    callbacks.current = { onEmotionChange, onPoke, onStep, onAutoChange }
  })

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const e = new AvatarCanvas(canvas, { shadow: false })
    const offs = [
      e.on("emotion", (n) => {
        setCurrent(n)
        callbacks.current.onEmotionChange?.(n)
      }),
      e.on("poke", () => callbacks.current.onPoke?.()),
      e.on("step", ({ step, index }) =>
        callbacks.current.onStep?.(step, index)
      ),
      e.on("auto", (s) => callbacks.current.onAutoChange?.(s)),
    ]
    engineRef.current = e
    return () => {
      offs.forEach((off) => off())
      e.destroy()
      engineRef.current = null
    }
  }, [])

  // Options. (These effects run after the one above, so the engine exists.)
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.set("style", eyeStyle)
    engine.set("intensity", reduced ? intensity * 0.4 : intensity)
    engine.set("size", size)
    engine.set("alive", alive)
    engine.set("lookAtPointer", lookAtPointer)
    engine.set("moodTint", moodTint)
    engine.set("particles", particles)
    engine.set("shadow", shadow)
    engine.set("blink", blink)
    engine.set("interactive", interactive)
    engine.set("boredAfter", boredAfter)
    engine.set("sleepAfter", sleepAfter)
  }, [
    eyeStyle,
    intensity,
    reduced,
    size,
    alive,
    lookAtPointer,
    moodTint,
    particles,
    shadow,
    blink,
    interactive,
    boredAfter,
    sleepAfter,
  ])

  React.useEffect(() => {
    engineRef.current?.setColors({
      body,
      eyes,
      particle: particleColor ?? null,
    })
  }, [body, eyes, particleColor])

  // What it's feeling: loop > mood > mix > emotion.
  const stableLoop = useStable(loop)
  const stableMood = useStable(mood)
  const stableMix = useStable(mix)
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (stableLoop) engine.play(stableLoop, { loop: loopRepeat })
    else if (stableMood) engine.setMood(stableMood[0], stableMood[1])
    else if (stableMix) engine.setMix(stableMix)
    else engine.setEmotion(emotion)
  }, [stableLoop, loopRepeat, stableMood, stableMix, emotion])

  React.useEffect(() => {
    engineRef.current?.setSpeaking(speaking)
  }, [speaking])

  React.useEffect(() => {
    engineRef.current?.setLevel(level ?? null, true)
  }, [level])

  React.useImperativeHandle(
    ref,
    () => ({
      setEmotion: (n) => engineRef.current?.setEmotion(n),
      setMix: (m) => engineRef.current?.setMix(m),
      setMood: (v, a) => engineRef.current?.setMood(v, a),
      react: (seq, d) => engineRef.current?.react(seq, d),
      gesture: (g) => engineRef.current?.gesture(g),
      play: (steps, options) => engineRef.current?.play(steps, options),
      stop: () => engineRef.current?.stop(),
      poke: () => engineRef.current?.poke(),
      setLevel: (l) => engineRef.current?.setLevel(l),
      setSpeaking: (on) => engineRef.current?.setSpeaking(on),
      get emotion() {
        return engineRef.current?.emotion ?? "idle"
      },
      get mix() {
        return engineRef.current?.mix ?? {}
      },
      get engine() {
        return engineRef.current
      },
    }),
    []
  )

  return (
    <div
      data-slot="emotive-avatar"
      data-emotion={current}
      role="img"
      aria-label={`${label}, ${EMOTION_DEFS[current].label.toLowerCase()}`}
      className={cn("relative aspect-square w-40 shrink-0", className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-manipulation"
      />
    </div>
  )
}

type EmotiveAvatarCrowdProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Number of dots. */
  count?: number
  /** [body, eyes] colour pairs, used in turn. */
  palette?: [string, string][]
  eyeStyle?: EyeStyle
  intensity?: number
  lookAtPointer?: boolean
  alive?: boolean
  particles?: boolean
  moodTint?: boolean
  /** Make everyone feel the same thing. Unset: each dot shuffles through its own moods. */
  emotion?: EmotionName
  mood?: Vec2
  loop?: RoutineName | "shuffle" | string | LoopStepInput[]
  speaking?: boolean
  onSelect?: (emotion: EmotionName) => void
}

function EmotiveAvatarCrowd({
  count = 7,
  palette = CROWD_PALETTE,
  eyeStyle = "type",
  intensity = 1,
  lookAtPointer = true,
  alive = true,
  particles = true,
  moodTint = false,
  emotion,
  mood,
  loop,
  speaking = false,
  onSelect,
  className,
  ...props
}: EmotiveAvatarCrowdProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const crowdRef = React.useRef<AvatarCrowdCanvas | null>(null)
  const [generation, setGeneration] = React.useState(0)
  const reduced = usePrefersReducedMotion()
  const onSelectRef = React.useRef(onSelect)
  React.useEffect(() => {
    onSelectRef.current = onSelect
  })
  const stablePalette = useStable(palette)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const c = new AvatarCrowdCanvas(canvas, {
      count: 0,
      palette: stablePalette,
    })
    c.onSelect = (face) => onSelectRef.current?.(face.emotion)
    crowdRef.current = c
    return () => {
      c.destroy()
      crowdRef.current = null
    }
  }, [stablePalette])

  React.useEffect(() => {
    const crowd = crowdRef.current
    if (!crowd) return
    crowd.set("style", eyeStyle)
    crowd.set("intensity", reduced ? intensity * 0.4 : intensity)
    crowd.set("lookAtPointer", lookAtPointer)
    crowd.set("alive", alive)
    crowd.set("particles", particles)
    crowd.set("moodTint", moodTint)
    const before = crowd.members.length
    crowd.set("count", count)
    // New dots need the current feeling too.
    if (crowd.members.length > before) setGeneration((g) => g + 1)
  }, [
    stablePalette,
    eyeStyle,
    intensity,
    reduced,
    lookAtPointer,
    alive,
    particles,
    moodTint,
    count,
  ])

  const stableLoop = useStable(loop)
  const stableMood = useStable(mood)
  React.useEffect(() => {
    const crowd = crowdRef.current
    if (!crowd) return
    if (stableLoop) crowd.play(stableLoop)
    else if (stableMood) crowd.setMood(stableMood[0], stableMood[1])
    else if (emotion) crowd.setEmotion(emotion)
    else crowd.play("shuffle")
    crowd.setSpeaking(speaking)
  }, [stablePalette, stableLoop, stableMood, emotion, speaking, generation])

  return (
    <div
      data-slot="emotive-avatar-crowd"
      role="img"
      aria-label={`${count} animated avatars`}
      className={cn("relative h-80 w-full overflow-hidden", className)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-manipulation"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Custom element: <emotive-avatar emotion="happy" eye-style="type" body="#8b4cf0"></emotive-avatar>
 * -----------------------------------------------------------------------------------------------*/

const ELEMENT_ATTRS = [
  "emotion",
  "mood",
  "loop",
  "loop-repeat",
  "speaking",
  "eye-style",
  "body",
  "eyes",
  "particle-color",
  "intensity",
  "size",
  "alive",
  "look-at-pointer",
  "mood-tint",
  "particles",
  "shadow",
  "blink",
  "interactive",
] as const

/**
 * Registers <emotive-avatar> (or your own tag name) for plain HTML pages. Attributes mirror the
 * React props in kebab-case; booleans are on when present unless set to "false". Methods:
 * gesture(), react(), play(), stop(), poke(), setLevel(), setMood(), setEmotion(). Events:
 * "emotionchange" (detail.emotion), "poke", "step" (detail.step, detail.index).
 */
function defineEmotiveAvatarElement(tagName = "emotive-avatar") {
  if (typeof window === "undefined" || customElements.get(tagName)) return

  class EmotiveAvatarElement extends HTMLElement {
    static observedAttributes = [...ELEMENT_ATTRS]
    engine: AvatarCanvas | null = null
    private offs: (() => void)[] = []

    connectedCallback() {
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" })
      if (!root.querySelector("canvas")) {
        root.innerHTML =
          "<style>:host{display:inline-block;position:relative;width:160px;height:160px}canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:manipulation}</style><canvas></canvas>"
      }
      if (!this.hasAttribute("role")) this.setAttribute("role", "img")
      const canvas = root.querySelector("canvas") as HTMLCanvasElement
      const engine = new AvatarCanvas(canvas, {
        shadow: false,
        size: 0.32,
        body: "currentColor",
        eyes: "Canvas",
      })
      this.engine = engine
      this.offs = [
        engine.on("emotion", (emotion) => {
          this.setAttribute(
            "aria-label",
            `${this.getAttribute("label") ?? "Avatar"}, ${EMOTION_DEFS[emotion].label.toLowerCase()}`
          )
          this.dispatchEvent(
            new CustomEvent("emotionchange", { detail: { emotion } })
          )
        }),
        engine.on("poke", () => this.dispatchEvent(new CustomEvent("poke"))),
        engine.on("step", ({ step, index }) =>
          this.dispatchEvent(
            new CustomEvent("step", { detail: { step, index } })
          )
        ),
      ]
      for (const a of ELEMENT_ATTRS) if (this.hasAttribute(a)) this.apply(a)
      this.applyFeeling()
    }

    disconnectedCallback() {
      this.offs.forEach((off) => off())
      this.engine?.destroy()
      this.engine = null
    }

    attributeChangedCallback(name: string) {
      if (this.engine) this.apply(name)
    }

    private flag(name: string, fallback: boolean) {
      const v = this.getAttribute(name)
      return v === null ? fallback : v !== "false"
    }

    private applyFeeling() {
      const e = this.engine
      if (!e) return
      const loop = this.getAttribute("loop")
      const mood = this.getAttribute("mood")
      const emotion = this.getAttribute("emotion") ?? "idle"
      if (loop) e.play(loop, { loop: this.flag("loop-repeat", true) })
      else if (mood) {
        const [v, a] = mood.split(/[\s,]+/).map(Number)
        e.setMood(v || 0, a || 0)
      } else if (isEmotion(emotion)) e.setEmotion(emotion)
    }

    private apply(name: string) {
      const e = this.engine
      if (!e) return
      const v = this.getAttribute(name)
      switch (name) {
        case "emotion":
        case "mood":
        case "loop":
        case "loop-repeat":
          this.applyFeeling()
          break
        case "speaking":
          e.setSpeaking(this.flag(name, false))
          break
        case "eye-style":
          e.set("style", v === "type" ? "type" : "pill")
          break
        case "body":
          e.setColors({ body: v ?? "currentColor" })
          break
        case "eyes":
          e.setColors({ eyes: v ?? "Canvas" })
          break
        case "particle-color":
          e.setColors({ particle: v })
          break
        case "intensity":
          e.set("intensity", v === null ? 1 : Number(v) || 0)
          break
        case "size":
          e.set("size", v === null ? 0.32 : Number(v) || 0.32)
          break
        case "alive":
          e.set("alive", this.flag(name, true))
          break
        case "look-at-pointer":
          e.set("lookAtPointer", this.flag(name, false))
          break
        case "mood-tint":
          e.set("moodTint", this.flag(name, false))
          break
        case "particles":
          e.set("particles", this.flag(name, true))
          break
        case "shadow":
          e.set("shadow", this.flag(name, false))
          break
        case "blink":
          e.set("blink", this.flag(name, true))
          break
        case "interactive":
          e.set("interactive", this.flag(name, true))
          break
      }
    }

    setEmotion(name: EmotionName) {
      this.engine?.setEmotion(name)
    }
    setMood(valence: number, arousal: number) {
      this.engine?.setMood(valence, arousal)
    }
    gesture(name: GestureName) {
      this.engine?.gesture(name)
    }
    react(seq: EmotionName | [EmotionName, number][], duration?: number) {
      this.engine?.react(seq, duration)
    }
    play(
      steps: RoutineName | "shuffle" | string | LoopStepInput[],
      options?: { loop?: boolean }
    ) {
      this.engine?.play(steps, options)
    }
    stop() {
      this.engine?.stop()
    }
    poke() {
      this.engine?.poke()
    }
    setLevel(level: number) {
      this.engine?.setLevel(level)
    }
  }

  customElements.define(tagName, EmotiveAvatarElement)
}

/* -------------------------------------------------------------------------------------------------
 * Exports
 * -----------------------------------------------------------------------------------------------*/

const EMOTION_LIST = EMOTION_NAMES.map((name) => ({
  name,
  label: EMOTION_DEFS[name].label,
  va: EMOTION_DEFS[name].va ?? null,
  mood: EMOTION_DEFS[name].mood !== false,
}))
const ROUTINE_LIST = (Object.keys(ROUTINES) as RoutineName[]).map((name) => ({
  name,
  label: ROUTINE_DEFS[name].label,
}))

export {
  EmotiveAvatar,
  EmotiveAvatarCrowd,
  defineEmotiveAvatarElement,
  AvatarFace,
  AvatarCanvas,
  AvatarCrowdCanvas,
  EMOTION_LIST,
  ROUTINE_LIST,
  GESTURES,
  CROWD_PALETTE,
  moodMix,
  parseSteps,
  type EmotiveAvatarProps,
  type EmotiveAvatarHandle,
  type EmotiveAvatarCrowdProps,
  type EmotionName,
  type EmotionMix,
  type GestureName,
  type RoutineName,
  type LoopStep,
  type LoopStepInput,
  type EyeStyle,
  type AvatarOptions,
}
