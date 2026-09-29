"use client"

import * as React from "react"
import { ImageIcon, RotateCwIcon } from "lucide-react"

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
 * being split into frames. "ready": `crop()` can be called.
 */
type ImageCropperStatus = "loading" | "decoding" | "ready"

type CropProgress = { done: number; total: number }

type CropOptions = {
  /** Called after each frame is encoded when producing an animated WebP. */
  onProgress?: (progress: CropProgress) => void
}

type ImageCropperHandle = {
  /** Render the current framing to a square `outputSize`×`outputSize` blob. */
  crop: (options?: CropOptions) => Promise<Blob>
  /** Back to minimum zoom, centred, unrotated. */
  reset: () => void
  /** Rotate 90° clockwise. */
  rotate: () => void
}

/**
 * One fully-composited animation frame (already resolved against the GIF's
 * disposal semantics) at the GIF's logical screen size. Held as ImageBitmaps
 * so `crop()` can draw them through the same transform as a static image.
 */
type GifFrame = { bmp: ImageBitmap; delayMs: number }

/* -------------------------------------------------------------------------------------------------
 * Geometry
 * -----------------------------------------------------------------------------------------------*/

const MAX_ZOOM = 4
// Gap between the crop cutout and the edge of the viewport.
const CROP_INSET = 14

function clampOffset(
  offset: Point,
  scale: number,
  natural: { w: number; h: number },
  rotation: number,
  cropRadius: number
): Point {
  const swapped = rotation === 90 || rotation === 270
  const effW = (swapped ? natural.h : natural.w) * scale
  const effH = (swapped ? natural.w : natural.h) * scale
  const maxX = Math.max(0, effW / 2 - cropRadius)
  const maxY = Math.max(0, effH / 2 - cropRadius)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image export failed"))),
      type,
      quality
    )
  )
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
  "children" | "ref"
> & {
  /** The image to crop. Animated GIFs keep their animation (see `animated`). */
  file: Blob
  ref?: React.Ref<ImageCropperHandle>
  /**
   * Shape of the cutout the user sees. The output is always a square image;
   * this only changes the mask. Default "circle" (avatars).
   */
  shape?: CropShape
  /** Viewport width in px. Default 320. */
  width?: number
  /** Viewport height in px. Default 260. */
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
  /** Show the zoom slider and rotate button. Default true. */
  controls?: boolean
  onStatusChange?: (status: ImageCropperStatus) => void
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
  controls = true,
  onStatusChange,
  className,
  ...props
}: ImageCropperProps) {
  const cropRadius = Math.max(8, Math.min(width, height) / 2 - CROP_INSET)
  const maskId = React.useId()

  // Per-file state is tagged with the file it belongs to, so a new `file`
  // reads as "not loaded / not decoded" straight away.
  const [loadedFile, setLoadedFile] = React.useState<Blob | null>(null)
  const [natural, setNatural] = React.useState({ w: 1, h: 1 })
  const [minScale, setMinScale] = React.useState(1)
  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState<Point>({ x: 0, y: 0 })
  const [rotation, setRotation] = React.useState(0)
  const [gif, setGif] = React.useState<{
    file: Blob
    frames: GifFrame[] | null
  } | null>(null)

  const loaded = loadedFile === file
  const wantsGif = animated && file.type === "image/gif"
  const decoding = wantsGif && gif?.file !== file
  const gifFrames = wantsGif && gif?.file === file ? gif.frames : null

  const maxScale = minScale * MAX_ZOOM
  const clamp = (o: Point, s: number, r: number) =>
    clampOffset(o, s, natural, r, cropRadius)

  const viewportRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  // Active pointer ids → current client positions
  const pointersRef = React.useRef(new Map<number, Point>())
  // State captured when a drag or pinch gesture begins
  const dragRef = React.useRef<{ start: Point; startOffset: Point } | null>(
    null
  )
  const pinchRef = React.useRef<{
    startDist: number
    startScale: number
    startOffset: Point
    startMid: Point
  } | null>(null)

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
      .catch((err) => {
        console.error("GIF decode failed; falling back to a static crop", err)
        return null
      })
      .then((frames) => {
        if (!cancelled) setGif({ file, frames })
      })
    return () => {
      cancelled = true
    }
  }, [file, wantsGif])

  React.useEffect(() => {
    return () => gif?.frames?.forEach((f) => f.bmp.close())
  }, [gif])

  const status: ImageCropperStatus = !loaded
    ? "loading"
    : decoding
      ? "decoding"
      : "ready"
  const onStatusChangeRef = React.useRef(onStatusChange)
  React.useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  })
  React.useEffect(() => {
    onStatusChangeRef.current?.(status)
  }, [status])

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    const ms = Math.max((cropRadius * 2) / w, (cropRadius * 2) / h)
    setNatural({ w, h })
    setMinScale(ms)
    setScale(ms)
    setOffset({ x: 0, y: 0 })
    setRotation(0)
    setLoadedFile(file)
  }

  // Zoom to `next`, keeping the point (mx, my) from the viewport centre fixed.
  function zoomTo(next: number, mx = 0, my = 0) {
    const newScale = Math.min(maxScale, Math.max(minScale, next))
    setScale(newScale)
    setOffset(
      clamp(zoomAround(mx, my, scale, newScale, offset), newScale, rotation)
    )
  }

  function reset() {
    setScale(minScale)
    setOffset({ x: 0, y: 0 })
    setRotation(0)
  }

  function rotate() {
    const next = (rotation + 90) % 360
    setRotation(next)
    setOffset((prev) => clamp(prev, scale, next))
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointersRef.current.values()]
    if (pts.length >= 2) {
      const [a, b] = pts
      pinchRef.current = {
        startDist: Math.hypot(b.x - a.x, b.y - a.y),
        startScale: scale,
        startOffset: offset,
        startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      dragRef.current = null
    } else {
      dragRef.current = {
        start: { x: e.clientX, y: e.clientY },
        startOffset: offset,
      }
      pinchRef.current = null
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointersRef.current.values()]

    if (pts.length >= 2 && pinchRef.current) {
      const { startDist, startScale, startOffset, startMid } = pinchRef.current
      const [a, b] = pts
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const newScale = Math.min(
        maxScale,
        Math.max(minScale, startScale * (dist / startDist))
      )
      // Zoom around the initial pinch midpoint, then add any panning.
      const rect = viewportRef.current!.getBoundingClientRect()
      const zoomed = zoomAround(
        startMid.x - rect.left - width / 2,
        startMid.y - rect.top - height / 2,
        startScale,
        newScale,
        startOffset
      )
      setScale(newScale)
      setOffset(
        clamp(
          {
            x: zoomed.x + mid.x - startMid.x,
            y: zoomed.y + mid.y - startMid.y,
          },
          newScale,
          rotation
        )
      )
    } else if (pts.length === 1 && dragRef.current) {
      const { start, startOffset } = dragRef.current
      setOffset(
        clamp(
          {
            x: startOffset.x + e.clientX - start.x,
            y: startOffset.y + e.clientY - start.y,
          },
          scale,
          rotation
        )
      )
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId)
    pinchRef.current = null
    const remaining = [...pointersRef.current.values()]
    dragRef.current =
      remaining.length === 1
        ? { start: remaining[0], startOffset: offset }
        : null
  }

  // Arrow keys pan (Shift = larger step); +/- zoom.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 20 : 5
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
        e.preventDefault()
        zoomTo(scale * 1.08)
        return
      case "-":
        e.preventDefault()
        zoomTo(scale / 1.08)
        return
      default:
        return
    }
    e.preventDefault()
    setOffset((prev) =>
      clamp({ x: prev.x + dx, y: prev.y + dy }, scale, rotation)
    )
  }

  // React's onWheel is passive, so preventDefault() there can't stop the
  // page scrolling. Attach a native non-passive listener instead.
  const zoomToRef = React.useRef(zoomTo)
  React.useEffect(() => {
    zoomToRef.current = zoomTo
  })
  const scaleRef = React.useRef(scale)
  React.useEffect(() => {
    scaleRef.current = scale
  }, [scale])
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomToRef.current(scaleRef.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Reproduce the preview's layout on the output canvas: centre → fit the
  // crop area to the output → pan/rotate/zoom → draw the source centred.
  // Static images and GIF frames share it so framing matches 1:1.
  function drawFrame(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    srcW: number,
    srcH: number
  ) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, outputSize, outputSize)
    if (background !== "transparent") {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, outputSize, outputSize)
    }
    ctx.translate(outputSize / 2, outputSize / 2)
    ctx.scale(outputSize / (cropRadius * 2), outputSize / (cropRadius * 2))
    ctx.translate(offset.x, offset.y)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(scale, scale)
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
    onProgress?: (p: CropProgress) => void
  ): Promise<Blob> {
    const { canvas, ctx } = createOutputCanvas()
    const encoded: WebPFrame[] = []
    for (let i = 0; i < frames.length; i++) {
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
      onProgress?.({ done: i + 1, total: frames.length })
      // Per-frame encoding is the slow step; yield so the UI can repaint.
      await new Promise((r) => setTimeout(r, 0))
    }
    return new Blob([muxAnimatedWebP(encoded, outputSize, outputSize)], {
      type: "image/webp",
    })
  }

  async function crop({ onProgress }: CropOptions = {}): Promise<Blob> {
    const img = imgRef.current
    if (!img || !loaded) throw new Error("Image not loaded yet")
    if (gifFrames && gifFrames.length > 0) {
      try {
        return await cropAnimated(gifFrames, onProgress)
      } catch (err) {
        console.warn("Animated crop failed; falling back to a static crop", err)
      }
    }
    const { canvas, ctx } = createOutputCanvas()
    drawFrame(ctx, img, natural.w, natural.h)
    return canvasToBlob(canvas, outputType, quality)
  }

  React.useImperativeHandle(ref, () => ({ crop, reset, rotate }))

  const cx = width / 2
  const cy = height / 2
  const cutout =
    shape === "square"
      ? {
          kind: "rect" as const,
          x: cx - cropRadius,
          y: cy - cropRadius,
          size: cropRadius * 2,
        }
      : { kind: "circle" as const }
  const sliderPct =
    maxScale > minScale ? (scale - minScale) / (maxScale - minScale) : 0

  return (
    <div
      data-slot="image-cropper"
      className={cn("flex w-fit max-w-full flex-col gap-3", className)}
      {...props}
    >
      <div
        ref={viewportRef}
        data-slot="image-cropper-viewport"
        role="application"
        tabIndex={0}
        aria-label="Reposition image. Arrow keys pan (hold Shift for larger steps); plus and minus zoom."
        className="relative mx-auto cursor-move touch-none overflow-hidden rounded-lg bg-black outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ width, height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <img
          ref={imgRef}
          onLoad={handleImageLoad}
          draggable={false}
          alt=""
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: natural.w * scale,
            height: natural.h * scale,
            top: cy - (natural.h * scale) / 2 + offset.y,
            left: cx - (natural.w * scale) / 2 + offset.x,
            transform: `rotate(${rotation}deg)`,
            visibility: loaded ? "visible" : "hidden",
          }}
        />

        {/* Dim overlay with a cutout + border in the crop shape. */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden
        >
          <defs>
            <mask id={maskId}>
              <rect width={width} height={height} fill="white" />
              {cutout.kind === "rect" ? (
                <rect
                  x={cutout.x}
                  y={cutout.y}
                  width={cutout.size}
                  height={cutout.size}
                  fill="black"
                />
              ) : (
                <circle cx={cx} cy={cy} r={cropRadius} fill="black" />
              )}
            </mask>
          </defs>
          <rect
            width={width}
            height={height}
            fill="rgba(0,0,0,0.55)"
            mask={`url(#${maskId})`}
          />
          {cutout.kind === "rect" ? (
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.size}
              height={cutout.size}
              fill="none"
              stroke="white"
              strokeWidth={2}
            />
          ) : (
            <circle
              cx={cx}
              cy={cy}
              r={cropRadius}
              fill="none"
              stroke="white"
              strokeWidth={2}
            />
          )}
        </svg>
      </div>

      {controls && (
        <div
          data-slot="image-cropper-controls"
          className="flex items-center gap-3 px-1"
        >
          <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <Slider
            aria-label="Zoom"
            min={0}
            max={100}
            step={1}
            value={[Math.round(sliderPct * 100)]}
            onValueChange={(v) => {
              const pct = (Array.isArray(v) ? v[0] : v) / 100
              zoomTo(minScale + pct * (maxScale - minScale))
            }}
            disabled={!loaded}
            className="flex-1"
          />
          <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={rotate}
            disabled={!loaded}
            aria-label="Rotate 90°"
            title="Rotate 90°"
          >
            <RotateCwIcon />
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
  "file" | "ref" | "onStatusChange" | "controls"
> & {
  /** The image to crop. The dialog is open while this is non-null. */
  file: Blob | null
  /** Receives the cropped image. The dialog shows "Applying…" until it settles. */
  onApply: (blob: Blob) => void | Promise<void>
  /** Cancel, Escape, clicking outside. Not called after a successful apply. */
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  applyLabel?: React.ReactNode
}

function ImageCropperDialog({
  file,
  onApply,
  onClose,
  title = "Edit image",
  description,
  applyLabel = "Apply",
  ...cropperProps
}: ImageCropperDialogProps) {
  const cropperRef = React.useRef<ImageCropperHandle>(null)
  const [status, setStatus] = React.useState<ImageCropperStatus>("loading")
  const [applying, setApplying] = React.useState(false)
  const [progress, setProgress] = React.useState<CropProgress | null>(null)
  // Keep rendering the last file while the dialog animates closed.
  const [shownFile, setShownFile] = React.useState(file)
  if (file && file !== shownFile) setShownFile(file)

  async function handleApply() {
    if (!cropperRef.current) return
    setApplying(true)
    try {
      const blob = await cropperRef.current.crop({ onProgress: setProgress })
      await onApply(blob)
    } finally {
      setApplying(false)
      setProgress(null)
    }
  }

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open && !applying) onClose()
      }}
    >
      <DialogContent
        className="w-fit max-w-[calc(100%-2rem)] sm:max-w-fit"
        showCloseButton={!applying}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {shownFile && (
          <ImageCropper
            ref={cropperRef}
            file={shownFile}
            onStatusChange={setStatus}
            className="mx-auto"
            {...cropperProps}
          />
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => cropperRef.current?.reset()}
            disabled={applying || status !== "ready"}
          >
            Reset
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={applying}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={applying || status !== "ready"}
            >
              {status === "decoding"
                ? "Decoding…"
                : progress
                  ? `Encoding ${progress.done}/${progress.total}…`
                  : applying
                    ? "Applying…"
                    : applyLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export {
  ImageCropper,
  ImageCropperDialog,
  muxAnimatedWebP,
  type CropOptions,
  type CropOutputType,
  type CropProgress,
  type CropShape,
  type ImageCropperDialogProps,
  type ImageCropperHandle,
  type ImageCropperProps,
  type ImageCropperStatus,
  type WebPFrame,
}
