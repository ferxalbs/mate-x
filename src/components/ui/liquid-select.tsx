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
          <div className="relative min-w-(--anchor-width) max-w-[min(22rem,var(--available-width))] overflow-hidden rounded-[24px]">

            {/* ── Glass canvas ────────────────────────────────────────────
                pointer-events-none so the canvas never steals clicks from
                the real list items sitting above it at z-10.               */}
            <div className="pointer-events-none absolute inset-0 z-0">
              <LiquidCanvas
                className="absolute inset-0"
                canvasClassName="absolute inset-0 h-full w-full rounded-[24px] bg-transparent"
              >
                <ZStack alignment="topLeading">

                  {/* Glass surface — hyper-transparent crystal glass with true DOM refraction (no static opaque backdrop) */}
                  <Frame maxWidth={Infinity} maxHeight={Infinity}>
                    <GlassContainer
                      bezelWidth={70}
                      blur={20}
                      displacementBlur={20}
                      shadowBlur={32}
                      shadowColor={{ r: 0, g: 0, b: 0, a: 0.12 }}
                      shadowOffsetY={10}
                      specularFalloff={1.2}
                      specularOpacity={0.50}
                      surfaceProfile="concave"
                      thickness={30}
                      tint={{ r: 1, g: 1, b: 1, a: 0.02 }}
                    >
                      <Glass cornerRadius={24} cornerSmoothing={0.6}>
                        <Frame maxWidth={Infinity} maxHeight={Infinity}>
                          <Html sizing="fill">
                            {/* Pristine transparent glass fallback without solid backgrounds to reveal active elements behind it */}
                            <div className="h-full w-full bg-transparent border border-white/5 backdrop-blur-[12px]" />
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
                "relative z-10 max-h-(--available-height) overflow-y-auto px-1.5 py-2",
                // Glass-surface item overrides:
                // • Highlighted / selected row: glassy flat segments matching the ultra-minimalist preference
                "[&_[data-slot=select-item]]:rounded-xl",
                "[&_[data-slot=select-item]]:mx-1",
                "[&_[data-slot=select-item]]:my-0.5",
                "[&_[data-slot=select-item]]:px-3",
                "[&_[data-slot=select-item]]:py-1.5",
                "[&_[data-slot=select-item]]:transition-all",
                "[&_[data-slot=select-item]]:duration-150",
                "[&_[data-slot=select-item]]:text-foreground/80",
                
                // Highlighted state (hover / keyboard focus): soft flat overlay
                "[&_[data-slot=select-item][data-highlighted]]:bg-white/8",
                "[&_[data-slot=select-item][data-highlighted]]:text-foreground",
                
                // Selected state: premium highlighted look, like native segments of a menu without heavy shadows
                "[&_[data-slot=select-item][data-selected]]:bg-white/12",
                "[&_[data-slot=select-item][data-selected]]:text-foreground",
                "[&_[data-slot=select-item][data-selected]]:font-medium",
                "[&_[data-slot=select-item][data-state=checked]]:bg-white/12",
                "[&_[data-slot=select-item][data-state=checked]]:text-foreground",
                "[&_[data-slot=select-item][data-state=checked]]:font-medium",
                "[&_[data-slot=select-item][aria-selected=true]]:bg-white/12",
                "[&_[data-slot=select-item][aria-selected=true]]:text-foreground",
                "[&_[data-slot=select-item][aria-selected=true]]:font-medium",
                
                // Dark mode adaptations
                "dark:[&_[data-slot=select-item][data-highlighted]]:bg-white/6",
                "dark:[&_[data-slot=select-item][data-selected]]:bg-white/10",
                "dark:[&_[data-slot=select-item][data-state=checked]]:bg-white/10",
                "dark:[&_[data-slot=select-item][aria-selected=true]]:bg-white/10",
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
