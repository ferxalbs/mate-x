import { describe, expect, it } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Switch } from "./switch"

describe("Apple-designed Switch component", () => {
  it("renders basic unchecked switch correctly", () => {
    const html = renderToStaticMarkup(<Switch checked={false}>Dark mode</Switch>)
    expect(html).toContain('data-slot="switch"')
    expect(html).toContain('data-slot="switch-thumb"')
    expect(html).toContain('data-slot="switch-content"')
    expect(html).toContain("Dark mode")
  })

  it("renders controlled selected switch without tacky glows", () => {
    const html = renderToStaticMarkup(
      <Switch checked={true} color="success" size="lg">
        Enable Notifications
      </Switch>
    )
    expect(html).toContain('data-checked=""')
    expect(html).toContain("data-checked:bg-[#34c759]")
    expect(html).not.toContain("shadow-[0_0_12px")
    expect(html).toContain("Enable Notifications")
  })

  it("supports startContent and endContent inside track", () => {
    const html = renderToStaticMarkup(
      <Switch
        checked={true}
        startContent={<span id="sun-icon">☀️</span>}
        endContent={<span id="moon-icon">🌙</span>}
      />
    )
    expect(html).toContain('id="sun-icon"')
    expect(html).toContain('id="moon-icon"')
  })

  it("supports thumbIcon prop", () => {
    const html = renderToStaticMarkup(
      <Switch
        checked={false}
        thumbIcon={({ isSelected }) => (
          <span id="thumb-icon">{isSelected ? "ON" : "OFF"}</span>
        )}
      />
    )
    expect(html).toContain('id="thumb-icon"')
    expect(html).toContain("OFF")
  })

  it("exposes compound subcomponents on Switch object", () => {
    if (typeof Switch.Root !== "object" && typeof Switch.Root !== "function") {
      throw new Error("Switch.Root is undefined")
    }
    if (typeof Switch.Control !== "object" && typeof Switch.Control !== "function") {
      throw new Error("Switch.Control is undefined")
    }
    if (typeof Switch.Thumb !== "object" && typeof Switch.Thumb !== "function") {
      throw new Error("Switch.Thumb is undefined")
    }
    if (typeof Switch.Content !== "function") {
      throw new Error("Switch.Content is undefined")
    }
  })
})
