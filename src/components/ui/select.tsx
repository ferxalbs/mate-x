"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowDataTransferVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as React from "react";

import { cn } from "~/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

const Select = SelectPrimitive.Root;

const selectTriggerVariants = cva(
  "relative inline-flex select-none items-center justify-between gap-2 border border-border/70 rounded-full text-left text-base outline-none transition-[color,box-shadow,background-color] duration-[var(--motion-press)] ease-[var(--ease-out)] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      variant: {
        default:
          "w-full min-w-36 bg-mate-control-bg text-foreground shadow-none ring-ring/24 focus-visible:border-ring focus-visible:ring-[3px] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:aria-invalid:ring-destructive/24 [&_svg:not([class*='opacity-'])]:opacity-80",
        ghost:
          "border-transparent text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground/80",
      },
      size: {
        default: "min-h-9 px-[calc(--spacing(3)-1px)] sm:min-h-8",
        lg: "min-h-10 px-[calc(--spacing(3)-1px)] sm:min-h-9",
        sm: "min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7",
        xs: "h-7 gap-1 rounded-xl px-[calc(--spacing(2)-1px)] text-sm before:rounded-[calc(var(--radius-xl)-1px)] sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
    },
  },
);

const selectTriggerIconClassName = "-me-1 size-4.5 opacity-80 sm:size-4";

interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  variant?: VariantProps<typeof selectTriggerVariants>["variant"];
}

function SelectButton({ className, size, variant, render, children, ...props }: SelectButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
          {children}
        </span>
        {variant === "ghost" ? (
          <ChevronDown className="size-3 opacity-50" />
        ) : (
          <HugeiconsIcon icon={ArrowDataTransferVerticalIcon} className={selectTriggerIconClassName} />
        )}
      </>
    ),
    className: cn(selectTriggerVariants({ size, variant }), "min-w-none", className),
    "data-slot": "select-button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ size, variant }), className)}
      data-slot="select-trigger"
      data-variant={variant}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronDown className="size-3 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate data-placeholder:text-muted-foreground", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  ...props
}: SelectPrimitive.Popup.Props & {
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}) {
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
            "relative flex not-[class*='w-']:min-w-36 origin-(--transform-origin) flex-col rounded-xl border border-border/40 text-foreground shadow-none outline-none focus:outline-none transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-ending-style:translate-y-[-2px] data-ending-style:opacity-0 data-starting-style:translate-y-[-2px] data-starting-style:opacity-0 motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-starting-style:translate-y-0",
            className,
          )}
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="top-0 z-50 flex h-5 w-full cursor-default items-center justify-center rounded-t-xl bg-popover/80 text-muted-foreground"
            data-slot="select-scroll-up-arrow"
          >
            <ChevronUp className="size-3.5" />
          </SelectPrimitive.ScrollUpArrow>
          <div
            className="relative size-full min-w-(--anchor-width) overflow-hidden rounded-xl"
            data-slot="select-content"
          >
            <SelectPrimitive.List
              className="max-h-[min(24rem,var(--available-height))] overflow-y-auto p-1.5"
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className="bottom-0 z-50 flex h-5 w-full cursor-default items-center justify-center rounded-b-xl bg-popover/80 text-muted-foreground"
            data-slot="select-scroll-down-arrow"
          >
            <ChevronDown className="size-3.5" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  hideIndicator = false,
  ...props
}: SelectPrimitive.Item.Props & {
  hideIndicator?: boolean;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "grid min-h-7 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default select-none items-center gap-1.5 rounded-lg py-1 text-xs text-foreground outline-none transition-colors duration-100 data-disabled:pointer-events-none data-highlighted:bg-accent/80 data-highlighted:text-accent-foreground data-disabled:opacity-64 active:scale-[0.99] [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        hideIndicator ? "grid-cols-[1fr] ps-2.5 pe-2.5" : "grid-cols-[1rem_1fr] ps-1.5 pe-3",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      {hideIndicator ? null : (
        <SelectPrimitive.ItemIndicator className="col-start-1" data-slot="select-item-indicator">
          <svg
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M5.252 12.7 10.2 18.63 18.748 5.37" />
          </svg>
        </SelectPrimitive.ItemIndicator>
      )}
      <SelectPrimitive.ItemText
        className={cn("min-w-0", hideIndicator ? "col-start-1" : "col-start-2")}
        data-slot="select-item-text"
      >
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
      data-slot="select-group-label"
      {...props}
    />
  );
}

export {
  Select,
  SelectTrigger,
  SelectButton,
  selectTriggerVariants,
  SelectValue,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectItem,
  SelectSeparator,
  SelectGroup,
  SelectGroupLabel,
};
