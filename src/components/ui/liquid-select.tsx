"use client";

import {
  Frame,
  Glass,
  GlassContainer,
  Html,
  LiquidCanvas,
  ZStack,
} from "@liquid-dom/react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Liquid-glass compatible select popup.
 *
 * Architecture follows the MenuDemo pattern exactly:
 *
 *   LiquidCanvas
 *     ZStack
 *       Html (zIndex=-2)   ← backdrop: var(--mate-shell-base) gradient
 *       Frame → GlassContainer → Glass → Html (fill) ← glass surface
 *   SelectPrimitive.List   ← real DOM, z-10, fully interactive
 *
 * GlassContainer parameters for a small floating panel:
 *   blur=120       moderate frost (smaller surface than sidebar)
 *   bezelWidth=60  narrow edge refraction — no wide lateral glow
 *   thickness=30   physical depth (MenuDemo uses 40 for context menus)
 *   specularOpacity=0.08  very subtle sheen — no white stripe
 *   tint=0         pure crystal, inherits colour from blurred backdrop
 *
 * Item hover on a glass surface uses rgba(255,255,255,0.10) — not the
 * solid --accent colour that looks wrong on transparent glass.
 */
export function LiquidSelectPopup({
  children,
  className,
  side = "top",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  anchor,
  ...props
}: {
  children?: ReactNode;
  className?: string;
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
} & Omit<SelectPrimitive.Popup.Props, "children">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50 select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            // Base UI provides --transform-origin for the open/close pivot point.
            "origin-(--transform-origin)",
            // Subtle scale + fade entrance / exit via Base UI's data attributes.
            "transition-[opacity,transform] duration-200 ease-out",
            "data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0",
          )}
          data-slot="select-popup"
          {...props}
        >
          {/*
            Outer shell — overflow-hidden clips both the canvas (glass) and the
            real list content to the same rounded-[20px] shape.
            min-w matches the anchor trigger; max-w caps on narrow viewports.
          */}
          <div className="relative min-w-(--anchor-width) max-w-[min(22rem,var(--available-width))] overflow-hidden rounded-[20px]">

            {/* ── Glass canvas ────────────────────────────────────────────
                pointer-events-none so the canvas never steals clicks from
                the real list items sitting above it at z-10.               */}
            <div className="pointer-events-none absolute inset-0 z-0">
              <LiquidCanvas
                className="absolute inset-0"
                canvasClassName="absolute inset-0 h-full w-full rounded-[20px] bg-transparent"
              >
                <ZStack alignment="topLeading">

                  {/* Backdrop: the same --mate-shell-base gradient that paints
                      the global app background. GlassContainer blurs this so
                      the panel looks like it genuinely frosts the scene.      */}
                  <Html sizing="fill" zIndex={-2}>
                    <div className="h-full w-full bg-[image:var(--mate-shell-base)]" />
                  </Html>

                  {/* Glass surface — concave, with physical thickness like the
                      MenuDemo context menu (thickness=30 vs MenuDemo's 40).   */}
                  <Frame maxWidth={Infinity} maxHeight={Infinity}>
                    <GlassContainer
                      bezelWidth={60}
                      blur={120}
                      displacementBlur={14}
                      shadowBlur={20}
                      shadowColor={{ r: 0, g: 0, b: 0, a: 0.18 }}
                      shadowOffsetY={6}
                      specularFalloff={1.8}
                      specularOpacity={0.08}
                      surfaceProfile="concave"
                      thickness={30}
                      tint={{ r: 1, g: 1, b: 1, a: 0 }}
                    >
                      <Glass cornerRadius={20} cornerSmoothing={0.4}>
                        <Frame maxWidth={Infinity} maxHeight={Infinity}>
                          <Html sizing="fill">
                            {/* Invisible fill — the glass surface just needs
                                a sized Html node; real content is z-10 DOM.   */}
                            <div className="h-full w-full" />
                          </Html>
                        </Frame>
                      </Glass>
                    </GlassContainer>
                  </Frame>

                </ZStack>
              </LiquidCanvas>
            </div>

            {/* ── Real interactive content ────────────────────────────────
                z-10 sits above the canvas. Base UI handles scrolling,
                keyboard nav, and ARIA automatically.                        */}
            <SelectPrimitive.ScrollUpArrow
              className="relative z-10 flex h-6 w-full cursor-default items-center justify-center text-foreground/50"
              data-slot="select-scroll-up-arrow"
            >
              <ChevronUpIcon className="size-3.5" />
            </SelectPrimitive.ScrollUpArrow>

            <SelectPrimitive.List
              className={cn(
                "relative z-10 max-h-(--available-height) overflow-y-auto px-1 py-1.5",
                // Glass-surface item overrides:
                // • Highlighted row: white/10 overlay instead of solid accent
                // • Text: full foreground (glass tint gives enough contrast)
                // • Rounded: 14px softer than the panel's 20px
                "[&_[data-slot=select-item]]:rounded-[14px]",
                "[&_[data-slot=select-item]]:text-foreground/85",
                "[&_[data-slot=select-item][data-highlighted]]:bg-white/10",
                "[&_[data-slot=select-item][data-highlighted]]:text-foreground",
                className,
              )}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>

            <SelectPrimitive.ScrollDownArrow
              className="relative z-10 flex h-6 w-full cursor-default items-center justify-center text-foreground/50"
              data-slot="select-scroll-down-arrow"
            >
              <ChevronDownIcon className="size-3.5" />
            </SelectPrimitive.ScrollDownArrow>

          </div>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}
