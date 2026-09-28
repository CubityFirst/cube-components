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
        <p className="text-sm text-muted-foreground">cube-components</p>
        <h1 className="text-xl font-medium">Color picker</h1>
        <pre className="w-fit max-w-full overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
          npx shadcn@latest add
          https://cubityfirst.github.io/cube-components/r/color-picker.json
        </pre>
        <p className="text-sm text-muted-foreground">
          Press <kbd>d</kbd> to toggle dark mode.
        </p>
      </header>

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
          <ColorPicker value={color} onValueChange={setColor} className="w-auto">
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
    </div>
  )
}

export default App
