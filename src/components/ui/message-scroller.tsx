import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { ScrollBar } from "./scroll-area"
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className="relative flex size-full min-h-0 flex-col overflow-hidden">
      <MessageScrollerPrimitive.Root
        data-slot="message-scroller"
        className={cn(
          "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
          className
        )}
        {...props}
      />
      <ScrollBar />
    </ScrollAreaPrimitive.Root>
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <ScrollAreaPrimitive.Viewport
      render={
        <MessageScrollerPrimitive.Viewport
          data-slot="message-scroller-viewport"
          className={cn(
            "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
            className
          )}
          {...props}
        />
      }
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-8", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = "end",
  placement = "center",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size"> & {
    placement?: "center" | "composer";
  }) {
  const placementClassName =
    placement === "composer"
      ? "absolute bottom-[calc(100%+0.75rem)] left-1/2 right-auto top-auto -translate-x-1/2"
      : "absolute inset-s-1/2 -translate-x-1/2 data-[direction=end]:bottom-4 data-[direction=start]:top-4";

  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        placementClassName,
        "border-border bg-background text-foreground transition-[translate,scale,opacity,background-color,color] duration-[var(--motion-menu)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[direction=end]:data-[active=false]:translate-y-2 data-[direction=start]:data-[active=false]:-translate-y-2 motion-reduce:data-[active=false]:translate-y-0 motion-reduce:data-[active=false]:scale-100 rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
