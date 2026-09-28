"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { PipetteIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/* -------------------------------------------------------------------------------------------------
 * Color math
 * -----------------------------------------------------------------------------------------------*/

/** h: 0-360, s: 0-100, v: 0-100, a: 0-1 */
type HSVA = { h: number; s: number; v: number; a: number }
type RGBA = { r: number; g: number; b: number; a: number }

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

function hsvaToRgba({ h, s, v, a }: HSVA): RGBA {
  const sat = s / 100
  const val = v / 100
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return {
    r: Math.round(f(5) * 255),
    g: Math.round(f(3) * 255),
    b: Math.round(f(1) * 255),
    a,
  }
}

function rgbaToHsva({ r, g, b, a }: RGBA): HSVA {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const d = max - Math.min(rn, gn, bn)
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100, a }
}

const toHexByte = (n: number) =>
  Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")

function hsvaToHex(color: HSVA, withAlpha = color.a < 1): string {
  const { r, g, b, a } = hsvaToRgba(color)
  const hex = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
  return withAlpha ? hex + toHexByte(a * 255) : hex
}

/** Parses `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa` (the `#` is optional). */
function hexToHsva(input: string): HSVA | null {
  let hex = input.trim().replace(/^#/, "")
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("")
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return rgbaToHsva({
    r: n(0),
    g: n(2),
    b: n(4),
    a: hex.length === 8 ? n(6) / 255 : 1,
  })
}

function hsvaToCss(color: HSVA): string {
  const { r, g, b, a } = hsvaToRgba(color)
  return a < 1 ? `rgb(${r} ${g} ${b} / ${a})` : `rgb(${r} ${g} ${b})`
}

/** h: 0-360, s: 0-100, l: 0-100, a: 0-1 */
type HSLA = { h: number; s: number; l: number; a: number }

/**
 * HSL saturation is undefined at pure black / white, so `fallbackS` (the last
 * meaningful value) is used there to keep the saturation bar from jumping.
 */
function hsvaToHsla({ h, s, v, a }: HSVA, fallbackS = 0): HSLA {
  const val = v / 100
  const l = val * (1 - s / 200)
  const m = Math.min(l, 1 - l)
  return { h, s: m < 1e-6 ? fallbackS : ((val - l) / m) * 100, l: l * 100, a }
}

/** HSV saturation is undefined at pure black, so `fallbackS` is kept there. */
function hslaToHsva({ h, s, l, a }: HSLA, fallbackS = 0): HSVA {
  const light = l / 100
  const v = light + (s / 100) * Math.min(light, 1 - light)
  return { h, s: v < 1e-6 ? fallbackS : 2 * (1 - light / v) * 100, v: v * 100, a }
}

function hslaToCss({ h, s, l, a }: HSLA): string {
  const hsl = `hsl(${h} ${s}% ${l}%`
  return a < 1 ? `${hsl} / ${a})` : `${hsl})`
}

/* -------------------------------------------------------------------------------------------------
 * Context
 * -----------------------------------------------------------------------------------------------*/

type ColorPickerContextValue = {
  /** Current color in HSV — drives the area. */
  color: HSVA
  /** Current color in HSL — drives the bars. */
  hsl: HSLA
  hex: string
  alpha: boolean
  disabled: boolean
  setColor: (patch: Partial<HSVA>) => void
  setHsl: (patch: Partial<HSLA>) => void
  commit: () => void
}

const ColorPickerContext = React.createContext<ColorPickerContextValue | null>(
  null
)

function useColorPicker() {
  const context = React.useContext(ColorPickerContext)
  if (!context) {
    throw new Error("useColorPicker must be used within a <ColorPicker />")
  }
  return context
}

const DEFAULT_COLOR: HSVA = { h: 217, s: 76, v: 96, a: 1 }

/** Keeps the current hue when the incoming color is achromatic (grey), so it isn't reset to red. */
function parseKeepingHue(value: string | undefined, current: HSVA) {
  const parsed = value ? hexToHsva(value) : null
  if (!parsed) return null
  return parsed.s === 0 || parsed.v === 0
    ? { ...parsed, h: current.h, s: parsed.v === 0 ? current.s : 0 }
    : parsed
}

/* -------------------------------------------------------------------------------------------------
 * ColorPicker (root)
 * -----------------------------------------------------------------------------------------------*/

type ColorPickerProps = Omit<
  React.ComponentProps<"div">,
  "defaultValue" | "onChange"
> & {
  /** Controlled hex value (`#rrggbb`, or `#rrggbbaa` when `alpha` is on). */
  value?: string
  defaultValue?: string
  /** Fires continuously while the user drags / types. */
  onValueChange?: (value: string, color: HSVA) => void
  /** Fires once when an interaction ends (pointer up, key up, input commit). */
  onValueCommit?: (value: string, color: HSVA) => void
  /** Enables the alpha channel (the `<ColorPickerAlpha />` bar and 8-digit hex output). */
  alpha?: boolean
  disabled?: boolean
}

function ColorPicker({
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  alpha = false,
  disabled = false,
  className,
  children,
  ...props
}: ColorPickerProps) {
  // HSV is the source of truth; `hsl` is kept alongside so HSL saturation
  // survives passing through black / white, where it's undefined.
  const [state, setState] = React.useState(() => {
    const parsed = hexToHsva(value ?? defaultValue ?? "")
    const color = parsed ? { ...parsed, a: alpha ? parsed.a : 1 } : DEFAULT_COLOR
    return { color, hsl: hsvaToHsla(color, 100) }
  })
  const { color, hsl } = state

  // Sync from a controlled `value`, ignoring echoes of what we just emitted so
  // hue / saturation aren't lost when round-tripping through hex.
  const [prevValue, setPrevValue] = React.useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    const parsed = parseKeepingHue(value, color)
    if (parsed && hsvaToHex(parsed, alpha) !== hsvaToHex(color, alpha)) {
      const next = { ...parsed, a: alpha ? parsed.a : 1 }
      setState({ color: next, hsl: hsvaToHsla(next, hsl.s) })
    }
  }

  const latest = React.useRef(state)
  React.useEffect(() => {
    latest.current = state
  }, [state])

  const callbacks = React.useRef({ onValueChange, onValueCommit })
  React.useEffect(() => {
    callbacks.current = { onValueChange, onValueCommit }
  }, [onValueChange, onValueCommit])

  const emit = React.useCallback(
    (next: { color: HSVA; hsl: HSLA }) => {
      if (!alpha) {
        next.color.a = 1
        next.hsl.a = 1
      }
      latest.current = next
      setState(next)
      callbacks.current.onValueChange?.(hsvaToHex(next.color, alpha), next.color)
    },
    [alpha]
  )

  const setColor = React.useCallback(
    (patch: Partial<HSVA>) => {
      const color = { ...latest.current.color, ...patch }
      emit({ color, hsl: hsvaToHsla(color, latest.current.hsl.s) })
    },
    [emit]
  )

  const setHsl = React.useCallback(
    (patch: Partial<HSLA>) => {
      const hsl = { ...latest.current.hsl, ...patch }
      emit({ color: hslaToHsva(hsl, latest.current.color.s), hsl })
    },
    [emit]
  )

  const commit = React.useCallback(() => {
    const { color } = latest.current
    callbacks.current.onValueCommit?.(hsvaToHex(color, alpha), color)
  }, [alpha])

  const context = React.useMemo<ColorPickerContextValue>(
    () => ({
      color,
      hsl,
      hex: hsvaToHex(color, alpha && color.a < 1),
      alpha,
      disabled,
      setColor,
      setHsl,
      commit,
    }),
    [color, hsl, alpha, disabled, setColor, setHsl, commit]
  )

  return (
    <ColorPickerContext.Provider value={context}>
      <div
        data-slot="color-picker"
        data-disabled={disabled || undefined}
        className={cn(
          "flex w-64 flex-col gap-3 data-disabled:pointer-events-none data-disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <ColorPickerArea />
            <ColorPickerHue />
            <ColorPickerSaturation />
            <ColorPickerLightness />
            <ColorPickerAlpha />
            <div className="flex items-center gap-2">
              <ColorPickerSwatch />
              <ColorPickerInput />
              <ColorPickerEyeDropper />
            </div>
          </>
        )}
      </div>
    </ColorPickerContext.Provider>
  )
}

/* -------------------------------------------------------------------------------------------------
 * ColorPickerArea — the big saturation (x) / brightness (y) gradient
 * -----------------------------------------------------------------------------------------------*/

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "8px 8px",
}

function ColorPickerArea({
  className,
  style,
  ...props
}: React.ComponentProps<"div">) {
  const { color, disabled, setColor, commit } = useColorPicker()

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setColor({
      s: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const moves: Record<string, Partial<HSVA>> = {
      ArrowLeft: { s: clamp(color.s - step, 0, 100) },
      ArrowRight: { s: clamp(color.s + step, 0, 100) },
      ArrowDown: { v: clamp(color.v - step, 0, 100) },
      ArrowUp: { v: clamp(color.v + step, 0, 100) },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    setColor(move)
  }

  return (
    <div
      data-slot="color-picker-area"
      role="slider"
      aria-roledescription="2D slider"
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(color.s)}
      aria-valuetext={`Saturation ${Math.round(color.s)}%, Brightness ${Math.round(color.v)}%`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "relative aspect-4/3 w-full cursor-crosshair touch-none rounded-lg ring-1 ring-foreground/10 outline-none select-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      style={{
        backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvaToCss({ h: color.h, s: 100, v: 100, a: 1 })})`,
        ...style,
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
        updateFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          updateFromPointer(event)
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) commit()
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key.startsWith("Arrow")) commit()
      }}
      {...props}
    >
      <div
        data-slot="color-picker-area-thumb"
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.4)]"
        style={{
          left: `${color.s}%`,
          top: `${100 - color.v}%`,
          backgroundColor: hsvaToCss({ ...color, a: 1 }),
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Channel bars — HSL: Hue / Saturation / Lightness, plus optional Alpha
 * -----------------------------------------------------------------------------------------------*/

type Channel = "h" | "s" | "l" | "a"

const CHANNELS: Record<
  Channel,
  {
    label: string
    max: number
    /** Hue wraps around, so the last step shouldn't duplicate the first. */
    wraps?: boolean
    /** Stops needed for an exact continuous gradient (HSL is piecewise-linear). */
    stops: number
    read: (c: HSLA) => number
    write: (n: number) => Partial<HSLA>
    format: (n: number) => string
  }
> = {
  h: {
    label: "Hue",
    max: 360,
    wraps: true,
    stops: 13,
    read: (c) => c.h,
    write: (h) => ({ h }),
    format: (n) => `${Math.round(n)}°`,
  },
  s: {
    label: "Saturation",
    max: 100,
    stops: 2,
    read: (c) => c.s,
    write: (s) => ({ s }),
    format: (n) => `${Math.round(n)}%`,
  },
  l: {
    label: "Lightness",
    max: 100,
    // Black → pure colour at 50% → white.
    stops: 3,
    read: (c) => c.l,
    write: (l) => ({ l }),
    format: (n) => `${Math.round(n)}%`,
  },
  a: {
    label: "Alpha",
    max: 100,
    stops: 2,
    read: (c) => c.a * 100,
    write: (n) => ({ a: n / 100 }),
    format: (n) => `${Math.round(n)}%`,
  },
}

/** Canonical base the bar is previewed against when `live` is off. */
const STATIC_BASE: HSLA = { h: 0, s: 100, l: 50, a: 1 }

type ColorPickerChannelProps = Omit<
  SliderPrimitive.Root.Props<number>,
  "value" | "defaultValue" | "onValueChange" | "min" | "max" | "step"
> & {
  channel: Channel
  /**
   * Split the bar into `steps` discrete swatches, each showing the exact color
   * that step produces. The thumb snaps to them. Omit for a continuous gradient.
   */
  steps?: number
  /**
   * When true (default), the bar previews every position against the *current*
   * color (e.g. the hue bar greys out as saturation drops). When false, it shows a
   * canonical fully-saturated gradient.
   */
  live?: boolean
}

function ColorPickerChannel({
  channel,
  steps,
  live = true,
  orientation = "horizontal",
  className,
  style,
  ...props
}: ColorPickerChannelProps) {
  const { color, hsl, disabled, setHsl, commit } = useColorPicker()
  const config = CHANNELS[channel]

  const segments = steps && steps >= 2 ? Math.round(steps) : undefined
  const max =
    segments && config.wraps ? config.max - config.max / segments : config.max
  const step = segments ? max / (segments - 1) : 1

  const base = live
    ? { ...hsl, a: 1 }
    : channel === "h"
      ? STATIC_BASE
      : { ...STATIC_BASE, h: hsl.h }
  const colorAt = (n: number) => hslaToCss({ ...base, ...config.write(n) })

  const vertical = orientation === "vertical"
  const direction = vertical ? "to top" : "to right"
  const gradient = `linear-gradient(${direction}, ${Array.from(
    { length: config.stops },
    (_, i) => colorAt((i / (config.stops - 1)) * config.max)
  ).join(", ")})`

  return (
    <SliderPrimitive.Root
      data-slot="color-picker-channel"
      data-channel={channel}
      aria-label={config.label}
      min={0}
      max={max}
      step={step}
      largeStep={segments ? step : config.max / 10}
      value={config.read(hsl)}
      onValueChange={(n) => setHsl(config.write(n))}
      onValueCommitted={commit}
      orientation={orientation}
      disabled={disabled}
      thumbAlignment="edge"
      className={cn(
        "[--color-picker-thumb:1.125rem] [--color-picker-track:0.75rem] data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
        className
      )}
      style={style}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="color-picker-channel-track"
          className="relative grow overflow-hidden rounded-full ring-1 ring-foreground/10 ring-inset data-[orientation=horizontal]:h-(--color-picker-track) data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-(--color-picker-track)"
          style={channel === "a" ? CHECKERBOARD : undefined}
        >
          {segments ? (
            <ChannelSegments
              count={segments}
              max={max}
              vertical={vertical}
              colorAt={colorAt}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ backgroundImage: gradient }}
            />
          )}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="color-picker-channel-thumb"
          getAriaValueText={(_, n) => config.format(n)}
          className="relative block size-(--color-picker-thumb) shrink-0 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_1px_3px_rgb(0_0_0/0.4)] transition-[box-shadow] select-none after:absolute after:-inset-2 focus-visible:shadow-[0_0_0_1px_rgb(0_0_0/0.3),0_0_0_4px_var(--ring)] focus-visible:outline-hidden"
          style={channel === "a" ? CHECKERBOARD : undefined}
        >
          <span
            className="absolute inset-0 rounded-full"
            style={{
              backgroundColor: hsvaToCss(channel === "a" ? color : { ...color, a: 1 }),
            }}
          />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

/**
 * Lays out swatches so each one is centred exactly where the (edge-aligned)
 * thumb lands for that step: thumb centres span `[t/2, 100% - t/2]`, so the
 * strip is widened by one step and shifted left by half a step, then clipped.
 */
function ChannelSegments({
  count,
  max,
  vertical,
  colorAt,
}: {
  count: number
  max: number
  vertical: boolean
  colorAt: (n: number) => string
}) {
  const travel = "(100% - var(--color-picker-thumb))"
  const size = `calc(${travel} * ${count} / ${count - 1})`
  const offset = `calc(var(--color-picker-thumb) / 2 - ${travel} / ${2 * (count - 1)})`

  return (
    <div
      className={cn("absolute flex", vertical && "flex-col-reverse")}
      style={
        vertical
          ? { left: 0, right: 0, bottom: offset, height: size }
          : { top: 0, bottom: 0, left: offset, width: size }
      }
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 border-transparent bg-clip-padding",
            vertical ? "border-y" : "border-x"
          )}
          style={{ backgroundColor: colorAt((i / (count - 1)) * max) }}
        />
      ))}
    </div>
  )
}

type ColorPickerBarProps = Omit<ColorPickerChannelProps, "channel">

function ColorPickerHue(props: ColorPickerBarProps) {
  return <ColorPickerChannel channel="h" {...props} />
}

function ColorPickerSaturation(props: ColorPickerBarProps) {
  return <ColorPickerChannel channel="s" {...props} />
}

function ColorPickerLightness(props: ColorPickerBarProps) {
  return <ColorPickerChannel channel="l" {...props} />
}

/** Renders only when the root has `alpha` enabled. */
function ColorPickerAlpha(props: ColorPickerBarProps) {
  const { alpha } = useColorPicker()
  if (!alpha) return null
  return <ColorPickerChannel channel="a" {...props} />
}

/* -------------------------------------------------------------------------------------------------
 * Swatch / Input / EyeDropper
 * -----------------------------------------------------------------------------------------------*/

function ColorPickerSwatch({
  className,
  style,
  ...props
}: React.ComponentProps<"div">) {
  const { color } = useColorPicker()
  return (
    <div
      data-slot="color-picker-swatch"
      className={cn(
        "relative size-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/10 ring-inset",
        className
      )}
      style={{ ...CHECKERBOARD, ...style }}
      {...props}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: hsvaToCss(color) }}
      />
    </div>
  )
}

function ColorPickerInput({
  className,
  onBlur,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "defaultValue">) {
  const { color, hex, alpha, disabled, setColor, commit } = useColorPicker()
  const [draft, setDraft] = React.useState<string | null>(null)
  const invalid = draft !== null && !hexToHsva(draft)

  const apply = () => {
    if (draft === null) return
    const parsed = parseKeepingHue(draft, color)
    if (parsed) {
      setColor(alpha ? parsed : { ...parsed, a: 1 })
      commit()
    }
    setDraft(null)
  }

  return (
    <Input
      data-slot="color-picker-input"
      aria-label="Hex color"
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      maxLength={alpha ? 9 : 7}
      disabled={disabled}
      className={cn("font-mono uppercase", className)}
      value={draft ?? hex}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        apply()
        onBlur?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") apply()
        if (event.key === "Escape") setDraft(null)
        onKeyDown?.(event)
      }}
      {...props}
    />
  )
}

type EyeDropperConstructor = new () => {
  open: () => Promise<{ sRGBHex: string }>
}

const subscribeNoop = () => () => {}

function ColorPickerEyeDropper({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { color, alpha, disabled, setColor, commit } = useColorPicker()
  const supported = React.useSyncExternalStore(
    subscribeNoop,
    () => "EyeDropper" in window,
    () => false
  )
  if (!supported) return null

  const pick = async () => {
    const EyeDropper = (window as unknown as { EyeDropper: EyeDropperConstructor })
      .EyeDropper
    try {
      const { sRGBHex } = await new EyeDropper().open()
      const parsed = parseKeepingHue(sRGBHex, color)
      if (parsed) {
        setColor({ ...parsed, a: alpha ? color.a : 1 })
        commit()
      }
    } catch {
      // User cancelled.
    }
  }

  return (
    <Button
      data-slot="color-picker-eye-dropper"
      type="button"
      variant="outline"
      size="icon"
      aria-label="Pick a color from the screen"
      disabled={disabled}
      className={className}
      onClick={pick}
      {...props}
    >
      {children ?? <PipetteIcon />}
    </Button>
  )
}

export {
  ColorPicker,
  ColorPickerArea,
  ColorPickerChannel,
  ColorPickerHue,
  ColorPickerSaturation,
  ColorPickerLightness,
  ColorPickerAlpha,
  ColorPickerSwatch,
  ColorPickerInput,
  ColorPickerEyeDropper,
  useColorPicker,
  hexToHsva,
  hsvaToHex,
  hsvaToRgba,
  rgbaToHsva,
  hsvaToCss,
  hsvaToHsla,
  hslaToHsva,
  hslaToCss,
  type HSVA,
  type RGBA,
  type HSLA,
  type ColorPickerProps,
  type ColorPickerChannelProps,
}
