"use client"

import * as React from "react"
import {
  ImageOffIcon,
  LoaderCircleIcon,
  MoveIcon,
  RotateCwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

type Point = { x: number; y: number }

type CropShape = "circle" | "square"

type CropOutputType = "image/webp" | "image/png" | "image/jpeg"

/**
 * "loading": the image hasn't loaded yet. "decoding": an animated GIF is
 * being split into frames. "ready": `crop()` can be called. "error": the
 * image couldn't be opened (unsupported format such as HEIC, or a damaged
 * file).
 */
type ImageCropperStatus = "loading" | "decoding" | "ready" | "error"

type CropProgress = { done: number; total: number }

type CropOptions = {
  /** Called after each frame is encoded when producing an animated WebP. */
  onProgress?: (progress: CropProgress) => void
  /** Aborts the crop; the promise then rejects with the signal's reason. */
  signal?: AbortSignal
}

type RotateDirection = "cw" | "ccw"

/** Why an animated GIF was saved as a still image instead. */
type CropFallbackReason = "gif-decode-failed" | "animated-encode-failed"

type ImageCropperHandle = {
  /** Render the current framing to a square `outputSize`×`outputSize` blob. */
  crop: (options?: CropOptions) => Promise<Blob>
  /** Back to minimum zoom, centred, unrotated. */
  reset: () => void
  /** Rotate 90°, clockwise by default. */
  rotate: (direction?: RotateDirection) => void
}

/**
 * One fully-composited animation frame (already resolved against the GIF's
 * disposal semantics) at the GIF's logical screen size. Held as ImageBitmaps
 * so `crop()` can draw them through the same transform as a static image.
 */
type GifFrame = { bmp: ImageBitmap; delayMs: number }

/* -------------------------------------------------------------------------------------------------
 * Geometry
 *
 * Framing is stored independently of the viewport's pixel size, so it
 * survives the viewport resizing: pan is measured in crop radii (1 = one
 * radius) and zoom is a multiplier on the smallest scale that still fills
 * the cutout.
 * -----------------------------------------------------------------------------------------------*/

const MAX_ZOOM = 4
// Gap between the crop cutout and the edge of the viewport.
const CROP_INSET = 14
// Zoom factor for the zoom buttons.
const ZOOM_STEP = 1.25
// Zoom factor for one +/- key press.
const KEY_ZOOM_STEP = 1.1

/**
 * Crop radii per source pixel. At zoom 1 the image's short side spans the
 * cutout exactly (2 radii).
 */
function unitsPerPixel(zoom: number, natural: { w: number; h: number }) {
  return (2 * zoom) / Math.min(natural.w, natural.h)
}

/** Keep the cutout covered by the image. `angle` is 0, 90, 180 or 270. */
function clampPan(
  pan: Point,
  zoom: number,
  natural: { w: number; h: number },
  angle: number
): Point {
  const swapped = angle === 90 || angle === 270
  const k = unitsPerPixel(zoom, natural)
  const maxX = Math.max(0, ((swapped ? natural.h : natural.w) * k) / 2 - 1)
  const maxY = Math.max(0, ((swapped ? natural.w : natural.h) * k) / 2 - 1)
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  }
}

/**
 * Zoom around a point (mx, my) relative to the viewport centre, keeping the
 * image pixel under that point fixed as the scale changes.
 */
function zoomAround(
  mx: number,
  my: number,
  oldScale: number,
  newScale: number,
  oldOffset: Point
): Point {
  const ratio = newScale / oldScale
  return {
    x: mx * (1 - ratio) + oldOffset.x * ratio,
    y: my * (1 - ratio) + oldOffset.y * ratio,
  }
}

function normalizeAngle(degrees: number) {
  return ((degrees % 360) + 360) % 360
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("The browser couldn't encode the image.")),
      type,
      quality
    )
  )
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Crop aborted", "AbortError")
  }
}

/**
 * Thin an animation evenly down to `max` frames, folding each dropped
 * frame's delay into the kept frame before it so the duration is unchanged.
 */
function limitFrames(frames: GifFrame[], max: number): GifFrame[] {
  const limit = Math.max(1, Math.floor(max))
  if (frames.length <= limit) return frames
  const out: GifFrame[] = []
  frames.forEach((frame, i) => {
    if (out.length === Math.floor((i * limit) / frames.length)) {
      out.push({ bmp: frame.bmp, delayMs: 0 })
    }
    out[out.length - 1].delayMs += frame.delayMs
  })
  return out
}

/* -------------------------------------------------------------------------------------------------
 * GIF decoding
 * -----------------------------------------------------------------------------------------------*/

async function decodeGifFrames(
  file: Blob,
  isCancelled: () => boolean
): Promise<GifFrame[] | null> {
  const [{ parseGIF, decompressFrames }, buf] = await Promise.all([
    import("gifuct-js"),
    file.arrayBuffer(),
  ])
  if (isCancelled()) return null
  const parsed = parseGIF(buf)
  const raw = decompressFrames(parsed, true)
  // Single-frame GIFs have no animation to preserve.
  if (raw.length <= 1) return null

  const lsdW = parsed.lsd.width
  const lsdH = parsed.lsd.height
  const compose = document.createElement("canvas")
  compose.width = lsdW
  compose.height = lsdH
  const ctx = compose.getContext("2d", { willReadFrequently: true })!

  const out: GifFrame[] = []
  let prevDisposal = 0
  let prevDims: {
    top: number
    left: number
    width: number
    height: number
  } | null = null
  let savedState: ImageData | null = null

  for (const frame of raw) {
    if (isCancelled()) {
      out.forEach((f) => f.bmp.close())
      return null
    }
    // Apply the previous frame's disposal before drawing this one.
    // 2 = clear the prior frame's rectangle; 3 = restore the canvas to how it
    // looked before the prior frame; 0/1 = leave alone (the common case).
    if (prevDisposal === 2 && prevDims) {
      ctx.clearRect(
        prevDims.left,
        prevDims.top,
        prevDims.width,
        prevDims.height
      )
    } else if (prevDisposal === 3 && savedState) {
      ctx.putImageData(savedState, 0, 0)
    }
    savedState =
      frame.disposalType === 3 ? ctx.getImageData(0, 0, lsdW, lsdH) : null

    // Composite the patch via a temp canvas so alpha=0 pixels don't overwrite
    // the cumulative state (putImageData replaces pixels, drawImage blends).
    const patch = document.createElement("canvas")
    patch.width = frame.dims.width
    patch.height = frame.dims.height
    patch
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(frame.patch),
          frame.dims.width,
          frame.dims.height
        ),
        0,
        0
      )
    ctx.drawImage(patch, frame.dims.left, frame.dims.top)

    out.push({
      bmp: await createImageBitmap(compose),
      delayMs: frame.delay > 0 ? frame.delay : 100,
    })
    prevDims = frame.dims
    prevDisposal = frame.disposalType ?? 0
  }
  if (isCancelled()) {
    out.forEach((f) => f.bmp.close())
    return null
  }
  return out
}

/* -------------------------------------------------------------------------------------------------
 * Animated WebP muxing
 *
 * Browsers can encode static WebP via canvas.toBlob("image/webp") but can't
 * build the animation container, so we do it here. Each frame covers the full
 * canvas and is composited "do not blend", fully replacing the previous one.
 *
 *   RIFF........WEBP
 *     VP8X (animation flag, canvas size)
 *     ANIM (loop count, background colour)
 *     ANMF × n (frame metadata + the static frame's VP8/VP8L/ALPH chunks)
 *
 * Reference: https://developers.google.com/speed/webp/docs/riff_container
 * -----------------------------------------------------------------------------------------------*/

type WebPFrame = { webp: Uint8Array; delayMs: number }

function muxAnimatedWebP(
  frames: WebPFrame[],
  width: number,
  height: number,
  loops = 0
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error("muxAnimatedWebP: no frames")

  const anmfChunks = frames.map((f) =>
    buildAnmf(extractBitstreamChunks(f.webp), width, height, f.delayMs)
  )
  const vp8x = buildVp8x(width, height)
  const anim = buildAnim(loops)

  const totalSize =
    12 +
    vp8x.byteLength +
    anim.byteLength +
    anmfChunks.reduce((s, c) => s + c.byteLength, 0)
  const out = new Uint8Array(totalSize)
  writeAscii(out, 0, "RIFF")
  writeU32LE(out, 4, totalSize - 8)
  writeAscii(out, 8, "WEBP")

  let o = 12
  for (const chunk of [vp8x, anim, ...anmfChunks]) {
    out.set(chunk, o)
    o += chunk.byteLength
  }
  return out
}

function buildVp8x(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(18)
  writeAscii(buf, 0, "VP8X")
  writeU32LE(buf, 4, 10)
  // Bit 1 of the flag byte = animation present. Everything else off.
  buf[8] = 0x02
  writeU24LE(buf, 12, width - 1)
  writeU24LE(buf, 15, height - 1)
  return buf
}

function buildAnim(loops: number): Uint8Array {
  const buf = new Uint8Array(14)
  writeAscii(buf, 0, "ANIM")
  writeU32LE(buf, 4, 6)
  // Background colour (BGRA) left transparent; every frame is opaque anyway.
  buf[12] = loops & 0xff
  buf[13] = (loops >>> 8) & 0xff
  return buf
}

function buildAnmf(
  payload: Uint8Array,
  width: number,
  height: number,
  delayMs: number
): Uint8Array {
  // Payload chunks are already RIFF-padded to even lengths, so the ANMF
  // chunk needs no trailing pad byte.
  const innerSize = 16 + payload.byteLength
  const buf = new Uint8Array(8 + innerSize)
  writeAscii(buf, 0, "ANMF")
  writeU32LE(buf, 4, innerSize)
  writeU24LE(buf, 8, 0) // frame X
  writeU24LE(buf, 11, 0) // frame Y
  writeU24LE(buf, 14, width - 1)
  writeU24LE(buf, 17, height - 1)
  writeU24LE(buf, 20, Math.min(Math.max(0, Math.round(delayMs)), 0xffffff))
  // Bit 1 = do not blend; bit 0 = no disposal.
  buf[23] = 0x02
  buf.set(payload, 24)
  return buf
}

/** Pull the VP8/VP8L/ALPH chunks out of a static WebP file. */
function extractBitstreamChunks(webp: Uint8Array): Uint8Array {
  if (
    webp.length < 12 ||
    readAscii(webp, 0, 4) !== "RIFF" ||
    readAscii(webp, 8, 4) !== "WEBP"
  ) {
    throw new Error("muxAnimatedWebP: input is not a WebP file")
  }
  let offset = 12
  const kept: Uint8Array[] = []
  while (offset + 8 <= webp.length) {
    const cc = readAscii(webp, offset, 4)
    const size = readU32LE(webp, offset + 4)
    const chunkEnd = offset + 8 + size + (size & 1)
    if (chunkEnd > webp.length) break
    if (cc === "VP8 " || cc === "VP8L" || cc === "ALPH") {
      kept.push(webp.subarray(offset, chunkEnd))
    }
    offset = chunkEnd
  }
  if (kept.length === 0) {
    throw new Error("muxAnimatedWebP: WebP has no VP8/VP8L bitstream")
  }
  const out = new Uint8Array(kept.reduce((s, p) => s + p.byteLength, 0))
  let o = 0
  for (const p of kept) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}

function writeU32LE(buf: Uint8Array, offset: number, v: number) {
  buf[offset] = v & 0xff
  buf[offset + 1] = (v >>> 8) & 0xff
  buf[offset + 2] = (v >>> 16) & 0xff
  buf[offset + 3] = (v >>> 24) & 0xff
}

function writeU24LE(buf: Uint8Array, offset: number, v: number) {
  buf[offset] = v & 0xff
  buf[offset + 1] = (v >>> 8) & 0xff
  buf[offset + 2] = (v >>> 16) & 0xff
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  )
}

function writeAscii(buf: Uint8Array, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i)
}

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  let s = ""
  for (let i = 0; i < len; i++) s += String.fromCharCode(buf[offset + i])
  return s
}

/* -------------------------------------------------------------------------------------------------
 * ImageCropper
 * -----------------------------------------------------------------------------------------------*/

type ImageCropperProps = Omit<
  React.ComponentProps<"div">,
  "children" | "ref" | "onError"
> & {
  /** The image to crop. Animated GIFs keep their animation (see `animated`). */
  file: Blob
  ref?: React.Ref<ImageCropperHandle>
  /**
   * Shape of the cutout the user sees. The output is always a square image;
   * this only changes the mask. Default "circle" (avatars).
   */
  shape?: CropShape
  /**
   * Largest viewport width in px. The viewport shrinks to fit narrower
   * containers, keeping the `width`:`height` ratio. Default 320.
   */
  width?: number
  /** Viewport height in px at full width. Default 260. */
  height?: number
  /** Output edge length in px. Default 512. */
  outputSize?: number
  /** Default "image/webp". Falls back to PNG where the browser can't encode it. */
  outputType?: CropOutputType
  /** Encoder quality for WebP/JPEG, 0-1. Default 0.9. */
  quality?: number
  /**
   * Fill behind the image in the output. Default "black" (matches the
   * viewport). Pass "transparent" to keep PNG/WebP transparency.
   */
  background?: string
  /**
   * Re-encode animated GIFs as animated WebP (always WebP, whatever
   * `outputType` is). Default true. When false, only the first frame is kept.
   */
  animated?: boolean
  /**
   * Most frames kept when re-encoding an animated GIF. Longer animations are
   * thinned evenly and keep their total duration. Default 120.
   */
  maxFrames?: number
  /** Show the zoom and rotate controls. Default true. */
  controls?: boolean
  /**
   * Instruction shown over the image until the first interaction. Pass
   * `false` to hide it. Default "Drag to reposition".
   */
  hint?: React.ReactNode
  /**
   * When the mouse wheel zooms. "focused" (default) zooms only while the
   * cropper has focus, so scrolling the page past it still scrolls; "always"
   * zooms whenever the pointer is over it (right for dialogs). Trackpad
   * pinch zooms either way.
   */
  wheelZoom?: "focused" | "always"
  /** Ignore all input, e.g. while the host is saving the result. */
  disabled?: boolean
  onStatusChange?: (status: ImageCropperStatus) => void
  /** The image couldn't be opened. The viewport shows an explanation. */
  onError?: (error: Error) => void
  /** An animated GIF will be (or was) saved as a still image instead. */
  onAnimationFallback?: (reason: CropFallbackReason, error: unknown) => void
}

function reportFallback(
  callbacks: { onAnimationFallback?: ImageCropperProps["onAnimationFallback"] },
  reason: CropFallbackReason,
  err: unknown
) {
  if (callbacks.onAnimationFallback) callbacks.onAnimationFallback(reason, err)
  else console.warn(`Saving GIF as a still image (${reason})`, err)
}

function ImageCropper({
  file,
  ref,
  shape = "circle",
  width = 320,
  height = 260,
  outputSize = 512,
  outputType = "image/webp",
  quality = 0.9,
  background = "black",
  animated = true,
  maxFrames = 120,
  controls = true,
  hint = "Drag to reposition",
  wheelZoom = "focused",
  disabled = false,
  onStatusChange,
  onError,
  onAnimationFallback,
  className,
  style,
  ...props
}: ImageCropperProps) {
  const maskId = React.useId()
  const instructionsId = React.useId()
  const zoomLabelId = React.useId()

  // Rendered viewport size; it shrinks below width × height in narrow
  // containers.
  const [size, setSize] = React.useState({ w: width, h: height })
  const cropRadius = Math.max(8, Math.min(size.w, size.h) / 2 - CROP_INSET)

  // Per-file state is tagged with the file it belongs to, so a new `file`
  // reads as "not loaded / not decoded / untouched" straight away.
  const [loadedFile, setLoadedFile] = React.useState<Blob | null>(null)
  const [failedFile, setFailedFile] = React.useState<Blob | null>(null)
  const [touchedFile, setTouchedFile] = React.useState<Blob | null>(null)
  const [natural, setNatural] = React.useState({ w: 1, h: 1 })
  const [zoom, setZoom] = React.useState(1)
  const [pan, setPan] = React.useState<Point>({ x: 0, y: 0 })
  // Cumulative degrees, so the CSS transition always turns the short way.
  const [rotation, setRotation] = React.useState(0)
  const [gif, setGif] = React.useState<{
    file: Blob
    frames: GifFrame[] | null
    failed: boolean
  } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<CropProgress | null>(null)
  const [announcement, setAnnouncement] = React.useState("")

  const loaded = loadedFile === file
  const failed = failedFile === file
  const touched = touchedFile === file
  const angle = normalizeAngle(rotation)
  const wantsGif = animated && file.type === "image/gif"
  const gifEntry = wantsGif && gif?.file === file ? gif : null
  const decoding = wantsGif && !gifEntry && !failed
  const gifFrames = gifEntry?.frames ?? null
  const interactive = loaded && !failed && !busy && !disabled
  const isDefaultFraming =
    zoom === 1 && pan.x === 0 && pan.y === 0 && angle === 0

  const rootRef = React.useRef<HTMLDivElement>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  // Active pointer ids → current client positions
  const pointersRef = React.useRef(new Map<number, Point>())
  // State captured when a drag or pinch gesture begins
  const dragRef = React.useRef<{ start: Point; startPan: Point } | null>(null)
  const pinchRef = React.useRef<{
    startDist: number
    startZoom: number
    startPan: Point
    startMid: Point
  } | null>(null)

  // Latest callbacks, so effects needn't re-run when a parent passes inline
  // functions.
  const callbacksRef = React.useRef({
    onStatusChange,
    onError,
    onAnimationFallback,
  })
  React.useEffect(() => {
    callbacksRef.current = { onStatusChange, onError, onAnimationFallback }
  })

  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) {
        setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const img = imgRef.current
    if (!img) return
    const url = URL.createObjectURL(file)
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Decode animated GIFs up front so crop() can push every frame through
  // the crop transform. Bitmaps are released by the effect below.
  React.useEffect(() => {
    if (!wantsGif) return
    let cancelled = false
    decodeGifFrames(file, () => cancelled)
      .then(
        (frames) => ({ frames, failed: false }),
        (err: unknown) => {
          if (!cancelled) {
            reportFallback(callbacksRef.current, "gif-decode-failed", err)
          }
          return { frames: null, failed: true }
        }
      )
      .then(({ frames, failed }) => {
        if (!cancelled) setGif({ file, frames, failed })
      })
    return () => {
      cancelled = true
    }
  }, [file, wantsGif])

  React.useEffect(() => {
    return () => gif?.frames?.forEach((f) => f.bmp.close())
  }, [gif])

  const status: ImageCropperStatus = failed
    ? "error"
    : !loaded
      ? "loading"
      : decoding
        ? "decoding"
        : "ready"
  React.useEffect(() => {
    callbacksRef.current.onStatusChange?.(status)
  }, [status])

  // Screen-reader announcements. Cleared first so a repeated message is
  // read again; zoom changes are debounced so a wheel spin reads once.
  const announceTimer = React.useRef<number | undefined>(undefined)
  function announce(message: string, delay = 0) {
    window.clearTimeout(announceTimer.current)
    setAnnouncement("")
    announceTimer.current = window.setTimeout(
      () => setAnnouncement(message),
      Math.max(delay, 50)
    )
  }
  React.useEffect(() => () => window.clearTimeout(announceTimer.current), [])

  function markTouched() {
    if (!touched) setTouchedFile(file)
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    setNatural({ w, h })
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
    setLoadedFile(file)
  }

  function handleImageError() {
    setFailedFile(file)
    callbacksRef.current.onError?.(new Error("The image couldn't be opened."))
  }

  /**
   * Zoom to `next`, keeping the point (mx, my) fixed. The point is relative
   * to the viewport centre, in crop radii.
   */
  function zoomTo(next: number, mx = 0, my = 0, { speak = true } = {}) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    if (z === zoom) return
    setZoom(z)
    setPan(clampPan(zoomAround(mx, my, zoom, z, pan), z, natural, angle))
    if (speak) announce(`Zoom ${Math.round(z * 100)}%`, 400)
  }

  function reset() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    // Unwind to the nearest whole turn so the transition takes the short way.
    setRotation((r) => {
      const a = normalizeAngle(r)
      return a <= 180 ? r - a : r + (360 - a)
    })
    announce("Framing reset")
  }

  function rotate(direction: RotateDirection = "cw") {
    const next = rotation + (direction === "cw" ? 90 : -90)
    const nextAngle = normalizeAngle(next)
    setRotation(next)
    setPan(clampPan(pan, zoom, natural, nextAngle))
    announce(`Rotated ${nextAngle}°`)
  }

  function endGestures() {
    pointersRef.current.clear()
    dragRef.current = null
    pinchRef.current = null
  }

  // A drag interrupted by the window losing focus must not resume later.
  React.useEffect(() => {
    window.addEventListener("blur", endGestures)
    return () => window.removeEventListener("blur", endGestures)
  }, [])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    // Two pointers are a pinch; ignore any beyond that.
    if (pointersRef.current.size >= 2) return
    markTouched()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointersRef.current.values()]
    if (pts.length === 2) {
      const [a, b] = pts
      pinchRef.current = {
        startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        startZoom: zoom,
        startPan: pan,
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      dragRef.current = null
    } else {
      dragRef.current = { start: { x: e.clientX, y: e.clientY }, startPan: pan }
      pinchRef.current = null
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || !pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointersRef.current.values()]

    if (pts.length === 2 && pinchRef.current) {
      const { startDist, startZoom, startPan, startMid } = pinchRef.current
      const [a, b] = pts
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const newZoom = Math.min(
        MAX_ZOOM,
        Math.max(1, startZoom * (dist / startDist))
      )
      // Zoom around the initial pinch midpoint, then add any panning.
      const rect = viewportRef.current!.getBoundingClientRect()
      const zoomed = zoomAround(
        (startMid.x - rect.left - size.w / 2) / cropRadius,
        (startMid.y - rect.top - size.h / 2) / cropRadius,
        startZoom,
        newZoom,
        startPan
      )
      setZoom(newZoom)
      setPan(
        clampPan(
          {
            x: zoomed.x + (mid.x - startMid.x) / cropRadius,
            y: zoomed.y + (mid.y - startMid.y) / cropRadius,
          },
          newZoom,
          natural,
          angle
        )
      )
    } else if (pts.length === 1 && dragRef.current) {
      const { start, startPan } = dragRef.current
      setPan(
        clampPan(
          {
            x: startPan.x + (e.clientX - start.x) / cropRadius,
            y: startPan.y + (e.clientY - start.y) / cropRadius,
          },
          zoom,
          natural,
          angle
        )
      )
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.delete(e.pointerId)) return
    pinchRef.current = null
    const remaining = [...pointersRef.current.values()]
    dragRef.current =
      remaining.length === 1 ? { start: remaining[0], startPan: pan } : null
  }

  // Arrow keys pan (Shift = larger step); +/- zoom; R rotates (Shift+R
  // anticlockwise); 0 resets.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive || e.altKey || e.ctrlKey || e.metaKey) return
    const step = (e.shiftKey ? 20 : 5) / cropRadius
    let dx = 0
    let dy = 0
    switch (e.key) {
      case "ArrowLeft":
        dx = -step
        break
      case "ArrowRight":
        dx = step
        break
      case "ArrowUp":
        dy = -step
        break
      case "ArrowDown":
        dy = step
        break
      case "+":
      case "=":
        zoomTo(zoom * KEY_ZOOM_STEP)
        break
      case "-":
      case "_":
        zoomTo(zoom / KEY_ZOOM_STEP)
        break
      case "r":
      case "R":
        rotate(e.shiftKey ? "ccw" : "cw")
        break
      case "0":
        reset()
        break
      default:
        return
    }
    e.preventDefault()
    markTouched()
    if (dx === 0 && dy === 0) return
    const wanted = { x: pan.x + dx, y: pan.y + dy }
    const next = clampPan(wanted, zoom, natural, angle)
    setPan(next)
    if (next.x !== wanted.x || next.y !== wanted.y) {
      const dir = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down"
      announce(`The image can't move further ${dir}.`)
    }
  }

  // React's onWheel is passive, so preventDefault() there can't stop the
  // page scrolling. Attach a native non-passive listener instead; it reads
  // the latest render through this ref.
  const wheelRef = React.useRef({
    interactive,
    wheelZoom,
    zoom,
    cropRadius,
    zoomTo,
    markTouched,
  })
  React.useEffect(() => {
    wheelRef.current = {
      interactive,
      wheelZoom,
      zoom,
      cropRadius,
      zoomTo,
      markTouched,
    }
  })
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const w = wheelRef.current
      if (!w.interactive) return
      // Trackpad pinch arrives as a ctrl+wheel event.
      const pinch = e.ctrlKey
      const focused = rootRef.current?.contains(document.activeElement)
      if (!pinch && w.wheelZoom === "focused" && !focused) return
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const factor = Math.exp(-e.deltaY * lines * (pinch ? 0.01 : 0.002))
      const rect = el.getBoundingClientRect()
      w.markTouched()
      w.zoomTo(
        w.zoom * factor,
        (e.clientX - rect.left - rect.width / 2) / w.cropRadius,
        (e.clientY - rect.top - rect.height / 2) / w.cropRadius
      )
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Reproduce the preview's layout on the output canvas: centre → one crop
  // radius = half the output → pan/rotate → scale source pixels → draw the
  // source centred. Static images and GIF frames share it so framing
  // matches 1:1.
  function drawFrame(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    srcW: number,
    srcH: number
  ) {
    const half = outputSize / 2
    const k = unitsPerPixel(zoom, natural)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, outputSize, outputSize)
    if (background !== "transparent") {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, outputSize, outputSize)
    }
    ctx.imageSmoothingQuality = "high"
    ctx.translate(half, half)
    ctx.scale(half, half)
    ctx.translate(pan.x, pan.y)
    ctx.rotate((angle * Math.PI) / 180)
    ctx.scale(k, k)
    ctx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH)
  }

  function createOutputCanvas() {
    const canvas = document.createElement("canvas")
    canvas.width = outputSize
    canvas.height = outputSize
    return { canvas, ctx: canvas.getContext("2d")! }
  }

  async function cropAnimated(
    frames: GifFrame[],
    onProgress: (p: CropProgress) => void,
    signal?: AbortSignal
  ): Promise<Blob> {
    const { canvas, ctx } = createOutputCanvas()
    const encoded: WebPFrame[] = []
    onProgress({ done: 0, total: frames.length })
    for (let i = 0; i < frames.length; i++) {
      throwIfAborted(signal)
      const f = frames[i]
      drawFrame(ctx, f.bmp, f.bmp.width, f.bmp.height)
      const blob = await canvasToBlob(canvas, "image/webp", quality)
      if (blob.type !== "image/webp") {
        throw new Error("This browser can't encode WebP")
      }
      encoded.push({
        webp: new Uint8Array(await blob.arrayBuffer()),
        delayMs: f.delayMs,
      })
      onProgress({ done: i + 1, total: frames.length })
      // Per-frame encoding is the slow step; yield so the UI can repaint.
      await new Promise((r) => setTimeout(r, 0))
    }
    throwIfAborted(signal)
    return new Blob([muxAnimatedWebP(encoded, outputSize, outputSize)], {
      type: "image/webp",
    })
  }

  async function crop({ onProgress, signal }: CropOptions = {}): Promise<Blob> {
    const img = imgRef.current
    if (failed) throw new Error("The image couldn't be opened.")
    if (!img || !loaded) throw new Error("The image hasn't loaded yet.")
    if (decoding) throw new Error("The animation is still loading.")
    throwIfAborted(signal)
    // Input is ignored while busy, so the framing can't drift from what
    // gets encoded.
    setBusy(true)
    try {
      if (gifFrames && gifFrames.length > 0) {
        try {
          return await cropAnimated(
            limitFrames(gifFrames, maxFrames),
            (p) => {
              setProgress(p)
              onProgress?.(p)
            },
            signal
          )
        } catch (err) {
          if (signal?.aborted) throw err
          setProgress(null)
          reportFallback(callbacksRef.current, "animated-encode-failed", err)
        }
      }
      const { canvas, ctx } = createOutputCanvas()
      drawFrame(ctx, img, natural.w, natural.h)
      const blob = await canvasToBlob(canvas, outputType, quality)
      throwIfAborted(signal)
      return blob
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  React.useImperativeHandle(ref, () => ({ crop, reset, rotate }))

  const cx = size.w / 2
  const cy = size.h / 2
  const pxPerSource = unitsPerPixel(zoom, natural) * cropRadius
  const imgW = natural.w * pxPerSource
  const imgH = natural.h * pxPerSource
  const cutout =
    shape === "square" ? (
      <rect
        x={cx - cropRadius}
        y={cy - cropRadius}
        width={cropRadius * 2}
        height={cropRadius * 2}
      />
    ) : (
      <circle cx={cx} cy={cy} r={cropRadius} />
    )
  // Stays mounted after the first interaction so it can fade out.
  const showHint = hint !== false && hint != null && loaded
  const gifStillNotice = loaded && gifEntry?.failed
  const iconButton =
    "relative text-muted-foreground after:absolute after:-inset-1"
  // Below 320px the slider and pinch cover zoom; the buttons would squeeze
  // the slider too far.
  const zoomButton = cn(iconButton, "@max-xs:hidden")

  return (
    <div
      ref={rootRef}
      data-slot="image-cropper"
      className={cn("@container flex w-full flex-col gap-3", className)}
      style={{ maxWidth: width, ...style }}
      {...props}
    >
      <div
        ref={viewportRef}
        data-slot="image-cropper-viewport"
        data-state={status}
        role="application"
        aria-label="Crop area"
        aria-describedby={instructionsId}
        aria-disabled={!interactive || undefined}
        aria-busy={busy || undefined}
        tabIndex={failed ? -1 : 0}
        className={cn(
          "relative w-full touch-none overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          interactive ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        )}
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <img
          ref={imgRef}
          onLoad={handleImageLoad}
          onError={handleImageError}
          draggable={false}
          alt=""
          className="pointer-events-none absolute max-w-none transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] select-none motion-reduce:transition-none"
          style={{
            width: imgW,
            height: imgH,
            left: cx - imgW / 2 + pan.x * cropRadius,
            top: cy - imgH / 2 + pan.y * cropRadius,
            transform: `rotate(${rotation}deg)`,
            opacity: loaded ? 1 : 0,
          }}
        />

        {/* Dim overlay with a cutout, outlined white over a soft dark halo
            so the edge holds up over bright and dark images alike. */}
        {!failed && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={size.w}
            height={size.h}
            aria-hidden
          >
            <defs>
              <mask id={maskId}>
                <rect width={size.w} height={size.h} fill="white" />
                <g fill="black">{cutout}</g>
              </mask>
            </defs>
            <rect
              width={size.w}
              height={size.h}
              fill="black"
              fillOpacity={0.55}
              mask={`url(#${maskId})`}
            />
            <g fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={4}>
              {cutout}
            </g>
            <g fill="none" stroke="white" strokeWidth={1.5}>
              {cutout}
            </g>
          </svg>
        )}

        {!loaded && !failed && (
          <div className="absolute inset-0 grid animate-in place-items-center delay-500 duration-300 fill-mode-both fade-in">
            <LoaderCircleIcon
              className="size-5 animate-spin text-white/70 motion-reduce:animate-none"
              aria-hidden
            />
            <span className="sr-only">Loading image</span>
          </div>
        )}

        {failed && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-6 text-center text-white"
          >
            <ImageOffIcon className="mb-1 size-6 text-white/60" aria-hidden />
            <p className="text-sm font-medium">Couldn't open this image</p>
            <p className="max-w-60 text-xs text-balance text-white/70">
              It may be damaged, or in a format this browser can't read. Try a
              JPG, PNG, WebP or GIF.
            </p>
          </div>
        )}

        {(decoding || gifStillNotice) && loaded && !progress && (
          <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs text-white">
              {decoding ? (
                <>
                  <LoaderCircleIcon
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  Loading animation…
                </>
              ) : (
                "Animation can't be kept; saves as a still image"
              )}
            </span>
          </div>
        )}

        {showHint && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-3 bottom-3 flex justify-center transition-opacity duration-300",
              interactive && !touched ? "opacity-100" : "opacity-0"
            )}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white">
              <MoveIcon className="size-3.5" />
              {hint}
            </span>
          </div>
        )}

        {busy && !progress && (
          // Delayed so a fast still encode doesn't flash it.
          <div className="absolute inset-0 flex animate-in flex-col items-center justify-center gap-3 bg-black/65 text-white delay-500 duration-300 fill-mode-both fade-in">
            <LoaderCircleIcon
              className="size-5 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            <p className="text-sm font-medium">Processing…</p>
          </div>
        )}

        {progress && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 px-10 text-white">
            <p className="text-sm font-medium">Processing animation…</p>
            <div
              role="progressbar"
              aria-label="Processing animation"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-valuetext={`${progress.done} of ${progress.total} frames`}
              className="h-1 w-full max-w-48 overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full rounded-full bg-white transition-[width] duration-150"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-white/70 tabular-nums">
              {progress.done} of {progress.total} frames
            </p>
          </div>
        )}
      </div>

      <p id={instructionsId} className="sr-only">
        Drag, or use the arrow keys, to move the image. Hold Shift for bigger
        steps. Plus and minus zoom, R rotates, 0 resets.
      </p>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {controls && (
        <div
          data-slot="image-cropper-controls"
          className="flex items-center gap-2"
        >
          <span id={zoomLabelId} className="sr-only">
            Zoom
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={zoomButton}
            onClick={() => zoomTo(zoom / ZOOM_STEP)}
            disabled={!interactive || zoom <= 1}
            aria-label="Zoom out"
          >
            <ZoomOutIcon />
          </Button>
          <Slider
            aria-labelledby={zoomLabelId}
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            format={{ style: "percent", maximumFractionDigits: 0 }}
            value={[zoom]}
            onValueChange={(v) => {
              markTouched()
              zoomTo(Array.isArray(v) ? v[0] : v, 0, 0, { speak: false })
            }}
            disabled={!interactive}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={zoomButton}
            onClick={() => zoomTo(zoom * ZOOM_STEP)}
            disabled={!interactive || zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <ZoomInIcon />
          </Button>
          <div aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={iconButton}
            onClick={() => rotate()}
            disabled={!interactive}
            aria-label="Rotate 90° clockwise"
            title="Rotate (R)"
          >
            <RotateCwIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative text-muted-foreground after:absolute after:-inset-x-1 after:-inset-y-2"
            onClick={reset}
            disabled={!interactive || isDefaultFraming}
            title="Reset (0)"
          >
            Reset
          </Button>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------
 * ImageCropperDialog
 * -----------------------------------------------------------------------------------------------*/

type ImageCropperDialogProps = Omit<
  ImageCropperProps,
  "file" | "ref" | "onStatusChange" | "controls" | "disabled"
> & {
  /** The image to crop. The dialog is open while this is non-null. */
  file: Blob | null
  /**
   * Receives the cropped image. The dialog stays busy until it settles;
   * throw (or reject) to keep it open and show the error's message.
   */
  onApply: (blob: Blob) => void | Promise<void>
  /**
   * Cancel, Escape, clicking outside. Cancelling while an animation is being
   * processed stops it. Not called after a successful apply.
   */
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  applyLabel?: React.ReactNode
}

/** "processing": crop() is running. "saving": onApply is running. */
type ApplyPhase = "idle" | "processing" | "saving"

function errorDetail(err: unknown) {
  return err instanceof Error && err.message ? err.message : "Please try again."
}

function ImageCropperDialog({
  file,
  onApply,
  onClose,
  title = "Crop image",
  description,
  applyLabel = "Apply",
  width = 320,
  wheelZoom = "always",
  ...cropperProps
}: ImageCropperDialogProps) {
  const cropperRef = React.useRef<ImageCropperHandle>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const [status, setStatus] = React.useState<ImageCropperStatus>("loading")
  const [phase, setPhase] = React.useState<ApplyPhase>("idle")
  const [error, setError] = React.useState<{
    title: string
    detail: string
  } | null>(null)
  // Keep rendering the last file while the dialog animates closed.
  const [shownFile, setShownFile] = React.useState(file)
  if (file && file !== shownFile) {
    setShownFile(file)
    setError(null)
  }

  const busy = phase !== "idle"

  // Closing or swapping the file from outside stops in-flight processing.
  React.useEffect(() => () => abortRef.current?.abort(), [file])

  async function handleApply() {
    const cropper = cropperRef.current
    if (!cropper || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPhase("processing")
    let blob: Blob
    try {
      blob = await cropper.crop({ signal: controller.signal })
    } catch (err) {
      if (!controller.signal.aborted) {
        setError({
          title: "Couldn't process the image.",
          detail: errorDetail(err),
        })
      }
      setPhase("idle")
      return
    } finally {
      abortRef.current = null
    }
    setPhase("saving")
    try {
      await onApply(blob)
    } catch (err) {
      setError({ title: "Couldn't save the image.", detail: errorDetail(err) })
    } finally {
      setPhase("idle")
    }
  }

  function requestClose() {
    // Processing can be stopped; the host's own save can't.
    if (phase === "saving") return
    abortRef.current?.abort()
    onClose()
  }

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        style={{ maxWidth: `min(calc(100% - 2rem), ${width + 32}px)` }}
        showCloseButton={phase !== "saving"}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {shownFile && (
          <ImageCropper
            ref={cropperRef}
            file={shownFile}
            width={width}
            wheelZoom={wheelZoom}
            disabled={phase === "saving"}
            onStatusChange={setStatus}
            className="mx-auto"
            {...cropperProps}
          />
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            <span className="font-medium">{error.title}</span> {error.detail}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={phase === "saving"}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="relative"
            onClick={handleApply}
            disabled={busy || status !== "ready"}
          >
            <span className={cn(busy && "opacity-0")}>{applyLabel}</span>
            {busy && (
              <LoaderCircleIcon
                className="absolute animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export {
  ImageCropper,
  ImageCropperDialog,
  muxAnimatedWebP,
  type CropFallbackReason,
  type CropOptions,
  type CropOutputType,
  type CropProgress,
  type CropShape,
  type ImageCropperDialogProps,
  type ImageCropperHandle,
  type ImageCropperProps,
  type ImageCropperStatus,
  type RotateDirection,
  type WebPFrame,
}
