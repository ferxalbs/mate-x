import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>,
  "size" | "onChange" | "children" | "className"
> {
  /**
   * Controlled checked state (Base-UI / Radix compatibility).
   */
  checked?: boolean;
  /**
   * Controlled selected state (HeroUI compatibility).
   */
  isSelected?: boolean;
  /**
   * Callback fired when checked state changes (Base-UI / Radix compatibility).
   */
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Callback fired when switch value changes (HeroUI / React Aria compatibility).
   */
  onChange?: (isSelected: boolean) => void;
  /**
   * Callback alias for onChange.
   */
  onValueChange?: (isSelected: boolean) => void;
  /**
   * Uncontrolled default checked state.
   */
  defaultChecked?: boolean;
  /**
   * Uncontrolled default selected state (HeroUI alias).
   */
  defaultSelected?: boolean;
  /**
   * Disabled state (Base-UI / Radix compatibility).
   */
  disabled?: boolean;
  /**
   * Disabled state (HeroUI compatibility).
   */
  isDisabled?: boolean;
  /**
   * Size of the switch control.
   * @default "default"
   */
  size?: "sm" | "default" | "md" | "lg";
  /**
   * Visual theme color variant when selected.
   * @default "primary"
   */
  color?: "primary" | "success" | "warning" | "danger" | "neutral";
  /**
   * Element or render function displayed inside the track on the start (left) side.
   */
  startContent?:
    | React.ReactNode
    | ((props: {
        isSelected: boolean;
        isDisabled?: boolean;
      }) => React.ReactNode);
  /**
   * Element or render function displayed inside the track on the end (right) side.
   */
  endContent?:
    | React.ReactNode
    | ((props: {
        isSelected: boolean;
        isDisabled?: boolean;
      }) => React.ReactNode);
  /**
   * Element or render function displayed inside the sliding thumb knob.
   */
  thumbIcon?:
    | React.ReactNode
    | ((props: {
        isSelected: boolean;
        isDisabled?: boolean;
      }) => React.ReactNode);
  /**
   * Custom slot classNames for fine-grained style overrides.
   */
  classNames?: {
    root?: string;
    control?: string;
    thumb?: string;
    content?: string;
    startContent?: string;
    endContent?: string;
    thumbIcon?: string;
  };
  /**
   * Optional custom root className.
   */
  className?: string;
  /**
   * Optional label or description node.
   */
  children?:
    | React.ReactNode
    | ((props: {
        isSelected: boolean;
        isDisabled?: boolean;
      }) => React.ReactNode);
}

function Switch({
  checked,
  isSelected: isSelectedProp,
  onCheckedChange,
  onChange,
  onValueChange,
  defaultChecked,
  defaultSelected,
  disabled,
  isDisabled: isDisabledProp,
  size = "default",
  color = "primary",
  startContent,
  endContent,
  thumbIcon,
  classNames,
  className,
  children,
  ...props
}: SwitchProps) {
  // Normalize controlled state & callbacks
  const isSelected = checked ?? isSelectedProp;
  const defaultSel = defaultChecked ?? defaultSelected;
  const isDisabled = disabled ?? isDisabledProp;

  const handleCheckedChange = (value: boolean) => {
    onCheckedChange?.(value);
    onChange?.(value);
    onValueChange?.(value);
  };

  const normalizedSize = size === "default" ? "md" : size;

  // Apple Design size specifications
  const sizeConfig = {
    sm: {
      control: "h-5 w-9 p-[2px]",
      thumb: "size-4",
      translate:
        "data-checked:translate-x-4 data-[state=checked]:translate-x-4",
      startIcon: "left-1 text-[10px]",
      endIcon: "right-1 text-[10px]",
      content: "text-xs",
    },
    md: {
      control: "h-6 w-11 p-[2px]",
      thumb: "size-5",
      translate:
        "data-checked:translate-x-5 data-[state=checked]:translate-x-5",
      startIcon: "left-1.5 text-xs",
      endIcon: "right-1.5 text-xs",
      content: "text-sm",
    },
    lg: {
      control: "h-7 w-[52px] p-[2.5px]",
      thumb: "size-6",
      translate:
        "data-checked:translate-x-[24px] data-[state=checked]:translate-x-[24px]",
      startIcon: "left-1.5 text-sm",
      endIcon: "right-1.5 text-sm",
      content: "text-base",
    },
  }[normalizedSize];

  // Apple restrained color variants (pure fills, NO tacky glows)
  const colorStyles = {
    primary:
      "data-checked:bg-primary dark:data-checked:bg-primary text-primary-foreground",
    success:
      "data-checked:bg-[#34c759] dark:data-checked:bg-[#30d158] text-white",
    warning:
      "data-checked:bg-[#ff9500] dark:data-checked:bg-[#ff9f0a] text-white",
    danger:
      "data-checked:bg-[#ff3b30] dark:data-checked:bg-[#ff453a] text-white",
    neutral:
      "data-checked:bg-zinc-800 dark:data-checked:bg-zinc-200 text-zinc-100 dark:text-zinc-900",
  }[color];

  // Compute current selection state for render callbacks
  const currentSelected = Boolean(isSelected);

  const resolvedStartContent =
    typeof startContent === "function"
      ? startContent({ isSelected: currentSelected, isDisabled })
      : startContent;

  const resolvedEndContent =
    typeof endContent === "function"
      ? endContent({ isSelected: currentSelected, isDisabled })
      : endContent;

  const resolvedThumbIcon =
    typeof thumbIcon === "function"
      ? thumbIcon({ isSelected: currentSelected, isDisabled })
      : thumbIcon;

  const resolvedChildren =
    typeof children === "function"
      ? children({ isSelected: currentSelected, isDisabled })
      : children;

  return (
    <label
      data-slot="switch-wrapper"
      className={cn(
        "group/switch relative inline-flex items-center gap-2.5 cursor-pointer select-none outline-none text-foreground",
        isDisabled && "cursor-not-allowed opacity-50 pointer-events-none",
        classNames?.root,
        className,
      )}
    >
      <BaseSwitch.Root
        data-slot="switch"
        checked={isSelected}
        defaultChecked={defaultSel}
        onCheckedChange={handleCheckedChange}
        disabled={isDisabled}
        className={cn(
          // Track layout & Apple smooth spring transition
          "peer relative inline-flex items-center shrink-0 rounded-full border border-transparent transition-colors duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer outline-none",
          // Unchecked state (Apple macOS / iOS dark & light neutral)
          "data-unchecked:bg-zinc-300 dark:data-unchecked:bg-zinc-700/80 hover:data-unchecked:bg-zinc-350 dark:hover:data-unchecked:bg-zinc-650/90",
          // Focus ring (Apple restrained focus outline)
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          // Color variant when checked
          colorStyles,
          sizeConfig.control,
          classNames?.control,
        )}
        {...props}
      >
        {/* Track start content (Left icon) */}
        {resolvedStartContent && (
          <span
            className={cn(
              "absolute flex items-center justify-center font-medium pointer-events-none transition-opacity duration-200",
              "group-data-[state=unchecked]/switch:opacity-0 group-data-[state=checked]/switch:opacity-100",
              sizeConfig.startIcon,
              classNames?.startContent,
            )}
          >
            {resolvedStartContent}
          </span>
        )}

        {/* Sliding Apple Thumb knob */}
        <BaseSwitch.Thumb
          data-slot="switch-thumb"
          className={cn(
            // Pure white disk with crisp natural drop shadow (NO glow)
            "pointer-events-none flex items-center justify-center rounded-full bg-white dark:bg-white text-zinc-900 shadow-[0_1px_3px_rgba(0,0,0,0.2),0_1px_1px_rgba(0,0,0,0.1)] border border-black/5 dark:border-none",
            // Apple fluid spring translation
            "transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] data-unchecked:translate-x-0 data-[state=unchecked]:translate-x-0",
            sizeConfig.thumb,
            sizeConfig.translate,
            // Tactile press spring expansion
            "active:scale-x-110 group-active/switch:scale-x-110",
            classNames?.thumb,
          )}
        >
          {resolvedThumbIcon && (
            <span
              className={cn(
                "flex items-center justify-center text-zinc-800 transition-opacity duration-150",
                classNames?.thumbIcon,
              )}
            >
              {resolvedThumbIcon}
            </span>
          )}
        </BaseSwitch.Thumb>

        {/* Track end content (Right icon) */}
        {resolvedEndContent && (
          <span
            className={cn(
              "absolute flex items-center justify-center font-medium pointer-events-none transition-opacity duration-200 text-muted-foreground",
              "group-data-[state=checked]/switch:opacity-0 group-data-[state=unchecked]/switch:opacity-100",
              sizeConfig.endIcon,
              classNames?.endContent,
            )}
          >
            {resolvedEndContent}
          </span>
        )}
      </BaseSwitch.Root>

      {/* Label / Content wrapper */}
      {resolvedChildren && (
        <span
          data-slot="switch-content"
          className={cn(
            "font-medium leading-none select-none cursor-pointer",
            sizeConfig.content,
            classNames?.content,
          )}
        >
          {resolvedChildren}
        </span>
      )}
    </label>
  );
}

// Subcomponent attachments for HeroUI compound component pattern compatibility
Switch.Root = BaseSwitch.Root;
Switch.Control = BaseSwitch.Root;
Switch.Thumb = BaseSwitch.Thumb;
Switch.Content = ({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"span">) => (
  <span
    className={cn(
      "font-medium leading-none select-none cursor-pointer text-sm",
      className,
    )}
    {...props}
  >
    {children}
  </span>
);
Switch.Icon = ({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"span">) => (
  <span
    className={cn("flex items-center justify-center", className)}
    {...props}
  >
    {children}
  </span>
);

export { Switch };
