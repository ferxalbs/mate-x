"use client";

import * as React from "react";
import { Switch as HeroUISwitch } from "@heroui/react";
import { cn } from "@/lib/utils";

// HeroUI v3 SwitchVariants only has `size` — no native `color` prop
type HeroUISize = "sm" | "md" | "lg";

// HeroUI v3 controls track color via CSS custom properties on the root element
// --switch-control-bg-checked is the authoritative variable for the "on" state
const COLOR_VAR: Record<string, string> = {
  primary:   "var(--color-primary, #3b82f6)",
  success:   "#34c759",
  warning:   "#ff9500",
  danger:    "#ff3b30",
  secondary: "var(--secondary)",
  neutral:   "#71717a",
  default:   "var(--color-primary, #3b82f6)",
};

export interface SwitchProps {
  /** Controlled checked state (Radix/Base-UI alias for isSelected). */
  checked?: boolean;
  /** Controlled selected state (HeroUI native). */
  isSelected?: boolean;
  /** Uncontrolled default checked state. */
  defaultChecked?: boolean;
  /** Uncontrolled default selected state. */
  defaultSelected?: boolean;
  /** Callback when value changes (boolean). */
  onCheckedChange?: (checked: boolean) => void;
  /** HeroUI-style callback. */
  onValueChange?: (value: boolean) => void;
  /** Disabled (Base-UI alias). */
  disabled?: boolean;
  /** Disabled (HeroUI native). */
  isDisabled?: boolean;
  /** Size: "sm" | "md" | "lg" | "default" (mapped to md). */
  size?: "sm" | "md" | "lg" | "default";
  /** Color variant applied via SwitchControl classNames. */
  color?: "default" | "primary" | "secondary" | "success" | "warning" | "danger" | "neutral";
  /** Content inside the track on the left side when selected. */
  startContent?: React.ReactNode | ((props: { isSelected: boolean }) => React.ReactNode);
  /** Content inside the track on the right side when unselected. */
  endContent?: React.ReactNode | ((props: { isSelected: boolean }) => React.ReactNode);
  /** Icon rendered inside the sliding thumb. */
  thumbIcon?: React.ReactNode | ((props: { isSelected: boolean }) => React.ReactNode);
  /** Slot-level className overrides. */
  classNames?: Partial<
    Record<
      | "base"
      | "wrapper"
      | "control"
      | "thumb"
      | "label"
      | "startContent"
      | "endContent"
      | "thumbIcon"
      | "root"
      | "content",
      string
    >
  >;
  className?: string;
  children?: React.ReactNode | ((props: { isSelected: boolean; isDisabled?: boolean }) => React.ReactNode);
}

const Switch = React.forwardRef<HTMLDivElement, SwitchProps>(
  (
    {
      checked,
      isSelected: isSelectedProp,
      defaultChecked,
      defaultSelected,
      onCheckedChange,
      onValueChange,
      disabled,
      isDisabled: isDisabledProp,
      size = "md",
      color = "primary",
      startContent,
      endContent,
      thumbIcon,
      classNames,
      className,
      children,
    },
    _ref
  ) => {
    const isDisabled = Boolean(isDisabledProp ?? disabled);
    const normalizedSize: HeroUISize = size === "default" ? "md" : size;

    // Controlled vs uncontrolled
    const isControlled = checked !== undefined || isSelectedProp !== undefined;
    const [internalSelected, setInternalSelected] = React.useState(
      defaultSelected ?? defaultChecked ?? false
    );
    const resolvedSelected = isControlled ? Boolean(isSelectedProp ?? checked) : internalSelected;

    // react-aria Switch onChange = (isSelected: boolean) => void
    const handleChange = (value: boolean) => {
      if (!isControlled) setInternalSelected(value);
      onCheckedChange?.(value);
      onValueChange?.(value);
    };

    // Resolve render-prop content
    const resolvedStart = typeof startContent === "function"
      ? startContent({ isSelected: resolvedSelected }) : startContent;
    const resolvedEnd = typeof endContent === "function"
      ? endContent({ isSelected: resolvedSelected }) : endContent;
    const resolvedThumb = typeof thumbIcon === "function"
      ? thumbIcon({ isSelected: resolvedSelected }) : thumbIcon;
    const resolvedChildren = typeof children === "function"
      ? children({ isSelected: resolvedSelected, isDisabled }) : children;

    const checkedColor = COLOR_VAR[color] ?? COLOR_VAR.primary;

    return (
      <HeroUISwitch
        size={normalizedSize}
        isSelected={resolvedSelected}
        isDisabled={isDisabled}
        onChange={handleChange}
        className={cn(classNames?.base, classNames?.root, className)}
        style={{ "--switch-control-bg-checked": checkedColor } as React.CSSProperties}
        data-slot="switch"
      >
        <HeroUISwitch.Content>
          <HeroUISwitch.Control
            className={cn(classNames?.control, classNames?.wrapper)}
            data-slot="switch-control"
          >
            {resolvedStart && (
              <span
                data-slot="switch-start-content"
                className={cn("flex items-center justify-center", classNames?.startContent)}
              >
                {resolvedStart}
              </span>
            )}
            <HeroUISwitch.Thumb
              className={cn(classNames?.thumb)}
              data-slot="switch-thumb"
            >
              {resolvedThumb && (
                <span
                  data-slot="switch-thumb-icon"
                  className={cn("flex items-center justify-center", classNames?.thumbIcon)}
                >
                  {resolvedThumb}
                </span>
              )}
            </HeroUISwitch.Thumb>
            {resolvedEnd && (
              <span
                data-slot="switch-end-content"
                className={cn("flex items-center justify-center", classNames?.endContent)}
              >
                {resolvedEnd}
              </span>
            )}
          </HeroUISwitch.Control>
        </HeroUISwitch.Content>
        {resolvedChildren && (
          <span
            className={cn("font-medium leading-none select-none", classNames?.label, classNames?.content)}
            data-slot="switch-content"
          >
            {resolvedChildren}
          </span>
        )}
      </HeroUISwitch>
    );
  }
);

Switch.displayName = "Switch";

// Compound subcomponent API compatibility
type SwitchCompound = typeof Switch & {
  Root: typeof HeroUISwitch;
  Control: typeof HeroUISwitch.Control;
  Thumb: typeof HeroUISwitch.Thumb;
  Content: typeof HeroUISwitch.Content;
  Icon: React.ForwardRefExoticComponent<
    React.ComponentPropsWithoutRef<"span"> & React.RefAttributes<HTMLSpanElement>
  >;
};

const CompoundSwitch = Switch as SwitchCompound;
CompoundSwitch.Root = HeroUISwitch;
CompoundSwitch.Control = HeroUISwitch.Control;
CompoundSwitch.Thumb = HeroUISwitch.Thumb;
CompoundSwitch.Content = HeroUISwitch.Content;
CompoundSwitch.Icon = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  ({ className: cls, children: ch, ...p }, r) => (
    <span ref={r} className={cn("flex items-center justify-center", cls)} {...p}>{ch}</span>
  )
);
CompoundSwitch.Icon.displayName = "HeroUI.Switch.Icon";

export { CompoundSwitch as Switch };
