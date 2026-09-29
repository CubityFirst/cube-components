import * as React from "react"

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

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5">
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
                style={{ backgroundColor: color }}
              />
              <span className="font-mono uppercase">{color}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <ColorPicker value={color} onValueChange={setColor} />
            </PopoverContent>
          </Popover>
        </Section>

        <Section
          title="Vertical bars"
          description='orientation="vertical" on any bar.'
        >
          <ColorPicker
            value={color}
            onValueChange={setColor}
            className="w-auto"
          >
            <div className="flex h-48 gap-3">
              <ColorPickerArea className="aspect-square h-full w-auto" />
              <ColorPickerHue orientation="vertical" />
              <ColorPickerSaturation orientation="vertical" steps={8} />
              <ColorPickerLightness orientation="vertical" live={false} />
            </div>
          </ColorPicker>
        </Section>

        <Section
          title="Static gradients"
          description="live={false} shows canonical gradients instead of previewing the current color."
        >
          <ColorPicker value={color} onValueChange={setColor}>
            <ColorPickerArea />
            <ColorPickerHue live={false} />
            <ColorPickerSaturation live={false} />
            <ColorPickerLightness live={false} />
          </ColorPicker>
        </Section>
      </div>

      <ComponentHeading title="Image cropper" name="image-cropper" />
      <ImageCropperDemos />
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

/** A generated placeholder so the inline cropper has something to show. */
function useSampleImage() {
  const [sample, setSample] = React.useState<Blob | null>(null)
  React.useEffect(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 900
    canvas.height = 600
    const ctx = canvas.getContext("2d")!
    const bg = ctx.createLinearGradient(0, 0, 900, 600)
    bg.addColorStop(0, "#6366f1")
    bg.addColorStop(1, "#f43f5e")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 900, 600)
    ctx.fillStyle = "rgba(255,255,255,0.85)"
    for (let i = 0; i < 9; i++) {
      ctx.beginPath()
      ctx.arc(100 + i * 90, 300 + Math.sin(i) * 150, 30 + i * 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.font = "bold 96px sans-serif"
    ctx.textAlign = "center"
    ctx.fillStyle = "white"
    ctx.fillText("cube", 450, 330)
    canvas.toBlob((b) => setSample(b), "image/png")
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

export default App
