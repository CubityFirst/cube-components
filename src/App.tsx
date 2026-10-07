import * as React from "react"

import samplePhotoUrl from "@/assets/sample-photo.jpg"
import { Button } from "@/components/ui/button"
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerArea,
  ColorPickerLightness,
  ColorPickerEyeDropper,
  ColorPickerHue,
  ColorPickerInput,
  ColorPickerSaturation,
  ColorPickerSwatch,
} from "@/registry/ui/color-picker"
import {
  ImageCropper,
  ImageCropperDialog,
  type ImageCropperHandle,
} from "@/registry/ui/image-cropper"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import {
  EMOTION_LIST,
  EmotiveAvatar,
  EmotiveAvatarCrowd,
  GESTURES,
  ROUTINE_LIST,
  defineEmotiveAvatarElement,
  moodMix,
  type EmotionName,
  type EmotiveAvatarHandle,
  type EyeStyle,
} from "@/registry/ui/emotive-avatar"

defineEmotiveAvatarElement()

function Section({
  title,
  description,
  className,
  children,
}: {
  title: string
  description: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={["flex flex-col gap-3 rounded-xl border p-5", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function App() {
  const [color, setColor] = React.useState("#3b82f6")
  const [stepped, setStepped] = React.useState("#e11d48")
  const [withAlpha, setWithAlpha] = React.useState("#10b981cc")
  const [popover, setPopover] = React.useState("#f59e0b")
  const [vertical, setVertical] = React.useState("#8b5cf6")
  const [staticBars, setStaticBars] = React.useState("#06b6d4")

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-medium">cube-components</h1>
        <p className="text-sm text-muted-foreground">
          Press <kbd>d</kbd> to toggle dark mode.
        </p>
      </header>

      <ComponentHeading title="Color picker" name="color-picker" />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Section
          title="Default"
          description="No children renders the default layout. Bars preview the current color."
        >
          <ColorPicker value={color} onValueChange={setColor} />
          <code className="text-xs text-muted-foreground">{color}</code>
        </Section>

        <Section
          title="Stepped bars"
          description="steps={n} splits each bar into swatches of the exact color each step gives."
        >
          <ColorPicker value={stepped} onValueChange={setStepped}>
            <ColorPickerArea />
            <ColorPickerHue steps={12} />
            <ColorPickerSaturation steps={10} />
            <ColorPickerLightness steps={10} />
            <div className="flex items-center gap-2">
              <ColorPickerSwatch />
              <ColorPickerInput />
            </div>
          </ColorPicker>
          <code className="text-xs text-muted-foreground">{stepped}</code>
        </Section>

        <Section
          title="Alpha"
          description="alpha enables the alpha bar and 8-digit hex output."
        >
          <ColorPicker alpha value={withAlpha} onValueChange={setWithAlpha}>
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
          </ColorPicker>
          <code className="text-xs text-muted-foreground">{withAlpha}</code>
        </Section>

        <Section
          title="In a popover"
          description="Composes with the shadcn Base UI Popover."
        >
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" className="w-fit justify-start" />
              }
            >
              <span
                className="size-4 rounded-sm ring-1 ring-foreground/10"
                style={{ backgroundColor: popover }}
              />
              <span className="font-mono uppercase">{popover}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <ColorPicker value={popover} onValueChange={setPopover} />
            </PopoverContent>
          </Popover>
        </Section>

        <Section
          title="Vertical bars"
          description='orientation="vertical" on any bar.'
        >
          <ColorPicker
            value={vertical}
            onValueChange={setVertical}
            className="w-auto"
          >
            <div className="flex h-48 gap-3">
              <ColorPickerArea className="aspect-square h-full w-auto" />
              <ColorPickerHue orientation="vertical" />
              <ColorPickerSaturation orientation="vertical" steps={8} />
              <ColorPickerLightness orientation="vertical" live={false} />
            </div>
          </ColorPicker>
          <code className="text-xs text-muted-foreground">{vertical}</code>
        </Section>

        <Section
          title="Static gradients"
          description="live={false} shows canonical gradients instead of previewing the current color."
        >
          <ColorPicker value={staticBars} onValueChange={setStaticBars}>
            <ColorPickerArea />
            <ColorPickerHue live={false} />
            <ColorPickerSaturation live={false} />
            <ColorPickerLightness live={false} />
          </ColorPicker>
          <code className="text-xs text-muted-foreground">{staticBars}</code>
        </Section>
      </div>

      <ComponentHeading title="Image cropper" name="image-cropper" />
      <ImageCropperDemos />

      <ComponentHeading title="Emotive avatar" name="emotive-avatar" />
      <EmotiveAvatarDemos />
    </div>
  )
}

function ComponentHeading({ title, name }: { title: string; name: string }) {
  return (
    <div className="flex flex-col gap-2 pt-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <pre className="w-fit max-w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
        npx shadcn@latest add https://cubityfirst.github.io/cube-components/r/
        {name}.json
      </pre>
    </div>
  )
}

/** Loads the bundled sample photo as a Blob for the inline cropper. */
function useSampleImage() {
  const [sample, setSample] = React.useState<Blob | null>(null)
  React.useEffect(() => {
    let cancelled = false
    fetch(samplePhotoUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (!cancelled) setSample(blob)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return sample
}

type CropResultValue = { blob: Blob; url: string } | null

/** Stores a crop result with an object URL, revoking the previous one. */
function useCropResult() {
  const [result, setResult] = React.useState<CropResultValue>(null)
  const update = (blob: Blob) => {
    if (result) URL.revokeObjectURL(result.url)
    setResult({ blob, url: URL.createObjectURL(blob) })
  }
  return [result, update] as const
}

function CropResult({
  result,
  shape,
}: {
  result: CropResultValue
  shape: "circle" | "square"
}) {
  if (!result) return null
  return (
    <div className="flex items-center gap-3">
      <img
        src={result.url}
        alt="Cropped result"
        className={
          shape === "circle" ? "size-16 rounded-full" : "size-16 rounded-md"
        }
      />
      <code className="text-xs text-muted-foreground">
        {result.blob.type}, {(result.blob.size / 1024).toFixed(1)} KB
      </code>
    </div>
  )
}

function ImageCropperDemos() {
  const sample = useSampleImage()
  const inlineRef = React.useRef<ImageCropperHandle>(null)
  const [inlineResult, setInlineResult] = useCropResult()

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [shape, setShape] = React.useState<"circle" | "square">("circle")
  const [pending, setPending] = React.useState<File | null>(null)
  const [dialogResult, setDialogResult] = useCropResult()

  function pick(nextShape: "circle" | "square") {
    setShape(nextShape)
    fileInputRef.current?.click()
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section
        title="Dialog"
        description="ImageCropperDialog opens while file is set. Try an animated GIF: it comes back as animated WebP."
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            setPending(e.target.files?.[0] ?? null)
            e.target.value = ""
          }}
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => pick("circle")}>
            Upload avatar…
          </Button>
          <Button variant="outline" onClick={() => pick("square")}>
            Upload icon…
          </Button>
        </div>
        <ImageCropperDialog
          file={pending}
          shape={shape}
          title={shape === "circle" ? "Edit avatar" : "Edit icon"}
          onApply={(blob) => {
            setDialogResult(blob)
            setPending(null)
          }}
          onClose={() => setPending(null)}
        />
        <CropResult result={dialogResult} shape={shape} />
      </Section>

      <Section
        title="Inline"
        description="ImageCropper on its own; call ref.current.crop() to get the blob. Drag, pinch, scroll or use the arrow keys."
      >
        {sample && (
          <ImageCropper ref={inlineRef} file={sample} shape="square" />
        )}
        <div className="flex gap-2">
          <Button
            onClick={async () =>
              setInlineResult(await inlineRef.current!.crop())
            }
          >
            Crop
          </Button>
          <Button variant="ghost" onClick={() => inlineRef.current?.reset()}>
            Reset
          </Button>
        </div>
        <CropResult result={inlineResult} shape="square" />
      </Section>
    </div>
  )
}

function ControlRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

const SWATCHES: {
  body: string
  eyes: string
  style: EyeStyle
  emotion: EmotionName
  size: string
}[] = [
  {
    body: "#8b4cf0",
    eyes: "#0d0d0d",
    style: "type",
    emotion: "surprised",
    size: "size-28",
  },
  {
    body: "#ff7a1f",
    eyes: "#0d0d0d",
    style: "type",
    emotion: "skeptical",
    size: "size-20",
  },
  {
    body: "#10b04f",
    eyes: "#0d0d0d",
    style: "type",
    emotion: "working",
    size: "size-24",
  },
  {
    body: "#0066ff",
    eyes: "#0d0d0d",
    style: "type",
    emotion: "laughing",
    size: "size-16",
  },
  {
    body: "#2b2b2b",
    eyes: "#ffffff",
    style: "pill",
    emotion: "happy",
    size: "size-20",
  },
  {
    body: "#ff5d8f",
    eyes: "#1a0b10",
    style: "pill",
    emotion: "love",
    size: "size-12",
  },
]

function EmotiveAvatarDemos() {
  const avatar = React.useRef<EmotiveAvatarHandle>(null)
  const [emotion, setEmotion] = React.useState<EmotionName>("idle")
  const [loop, setLoop] = React.useState<string | undefined>()
  const [eyeStyle, setEyeStyle] = React.useState<EyeStyle>("pill")
  const [speaking, setSpeaking] = React.useState(false)
  const [moodTint, setMoodTint] = React.useState(false)
  const [lookAtPointer, setLookAtPointer] = React.useState(false)
  const [current, setCurrent] = React.useState<EmotionName>("idle")
  const [valence, setValence] = React.useState(0.5)
  const [arousal, setArousal] = React.useState(0.4)

  const mix = Object.entries(moodMix(valence, arousal))
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([name, w]) => `${name} ${Math.round((w ?? 0) * 100)}%`)
    .join(" · ")
  const num = (v: number | readonly number[]) =>
    (Array.isArray(v) ? v[0] : v) as number

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section
        title="Playground"
        description="Click it to poke it. Leave it idle and it gets bored, then falls asleep; move the mouse to wake it."
        className="md:col-span-2"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <EmotiveAvatar
            ref={avatar}
            emotion={emotion}
            loop={loop}
            eyeStyle={eyeStyle}
            speaking={speaking}
            moodTint={moodTint}
            lookAtPointer={lookAtPointer}
            onEmotionChange={setCurrent}
            className="size-64 self-center"
          />
          <div className="flex flex-1 flex-col gap-4">
            <ControlRow label="Emotion">
              {EMOTION_LIST.map((e) => (
                <Button
                  key={e.name}
                  size="sm"
                  variant={!loop && emotion === e.name ? "default" : "outline"}
                  onClick={() => {
                    setLoop(undefined)
                    setEmotion(e.name)
                  }}
                >
                  {e.label}
                </Button>
              ))}
            </ControlRow>
            <ControlRow label="Gesture">
              {GESTURES.map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant="outline"
                  className="capitalize"
                  onClick={() => avatar.current?.gesture(g)}
                >
                  {g}
                </Button>
              ))}
            </ControlRow>
            <ControlRow label="Loop">
              {[...ROUTINE_LIST, { name: "shuffle", label: "Shuffle" }].map(
                (r) => (
                  <Button
                    key={r.name}
                    size="sm"
                    variant={loop === r.name ? "default" : "outline"}
                    onClick={() =>
                      setLoop(loop === r.name ? undefined : r.name)
                    }
                  >
                    {r.label}
                  </Button>
                )
              )}
            </ControlRow>
            <ControlRow label="Options">
              {(["pill", "type"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={eyeStyle === s ? "default" : "outline"}
                  className="capitalize"
                  onClick={() => setEyeStyle(s)}
                >
                  {s} eyes
                </Button>
              ))}
              <Button
                size="sm"
                variant={speaking ? "default" : "outline"}
                onClick={() => setSpeaking(!speaking)}
              >
                Talk
              </Button>
              <Button
                size="sm"
                variant={moodTint ? "default" : "outline"}
                onClick={() => setMoodTint(!moodTint)}
              >
                Mood colours
              </Button>
              <Button
                size="sm"
                variant={lookAtPointer ? "default" : "outline"}
                onClick={() => setLookAtPointer(!lookAtPointer)}
              >
                Follow cursor
              </Button>
            </ControlRow>
            <code className="text-xs text-muted-foreground">
              emotion: {current}
            </code>
          </div>
        </div>
      </Section>

      <Section
        title="Mood map"
        description="mood={[valence, arousal]} blends the nearest emotions instead of switching between them."
      >
        <EmotiveAvatar
          mood={[valence, arousal]}
          eyeStyle="type"
          className="size-40 self-center"
        />
        <label className="flex flex-col gap-2 text-xs text-muted-foreground">
          Valence (negative → positive)
          <Slider
            min={-1}
            max={1}
            step={0.05}
            value={[valence]}
            onValueChange={(v) => setValence(num(v))}
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-muted-foreground">
          Arousal (calm → energetic)
          <Slider
            min={-1}
            max={1}
            step={0.05}
            value={[arousal]}
            onValueChange={(v) => setArousal(num(v))}
          />
        </label>
        <code className="text-xs text-muted-foreground">{mix}</code>
      </Section>

      <Section
        title="Colours and sizes"
        description="Any CSS colour, including theme tokens. The defaults are var(--foreground) and var(--background), so it follows dark mode."
      >
        <div className="flex flex-wrap items-end justify-center gap-2">
          {SWATCHES.map((s) => (
            <EmotiveAvatar
              key={s.body}
              emotion={s.emotion}
              body={s.body}
              eyes={s.eyes}
              eyeStyle={s.style}
              className={s.size}
            />
          ))}
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <EmotiveAvatar
            loop="assistant"
            particles={false}
            className="size-10"
          />
          <p className="text-sm">
            Small sizes work as an assistant&apos;s face in a chat.
          </p>
        </div>
      </Section>

      <Section
        title="Crowd"
        description="EmotiveAvatarCrowd: dots drift, bump into each other, react, and look at each other or your cursor."
        className="md:col-span-2"
      >
        <EmotiveAvatarCrowd className="rounded-lg bg-black" />
      </Section>

      <Section
        title="Custom element"
        description="defineEmotiveAvatarElement() registers <emotive-avatar> for pages without React."
        className="md:col-span-2"
      >
        <div className="flex flex-col items-center gap-4 md:flex-row">
          {React.createElement("emotive-avatar", {
            emotion: "playful",
            "eye-style": "type",
            body: "#10b04f",
            eyes: "#0d0d0d",
            style: { width: 128, height: 128 },
          })}
          <pre className="w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
            {`defineEmotiveAvatarElement()

<emotive-avatar emotion="playful" eye-style="type"
  body="#10b04f" eyes="#0d0d0d"></emotive-avatar>

document.querySelector("emotive-avatar").gesture("spin")`}
          </pre>
        </div>
      </Section>
    </div>
  )
}

export default App
