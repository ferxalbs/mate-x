"use client";

import { Slider as HeroUISlider, Label } from "@heroui/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "~/lib/utils";

export interface SliderProps
  extends Omit<ComponentPropsWithoutRef<typeof HeroUISlider>, "onChange"> {
  label?: ReactNode;
  showValueLabel?: boolean;
  min?: number;
  max?: number;
  thumbLabel?: string;
  onValueChange?: (value: number | number[]) => void;
  onChange?: (value: number | number[]) => void;
  disabled?: boolean;
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  minValue,
  maxValue,
  step = 1,
  thumbLabel = "Slider value",
  label,
  showValueLabel = false,
  onValueChange,
  onChange,
  disabled,
  isDisabled,
  orientation = "horizontal",
  ...props
}: SliderProps) {
  const actualMin = minValue ?? min;
  const actualMax = maxValue ?? max;
  const actualDisabled = isDisabled ?? disabled;

  const handleChange = (val: number | number[]) => {
    onValueChange?.(val);
    onChange?.(val);
  };

  const values = Array.isArray(value)
    ? value
    : typeof value === "number"
      ? [value]
      : Array.isArray(defaultValue)
        ? defaultValue
        : typeof defaultValue === "number"
          ? [defaultValue]
          : [actualMin];

  return (
    <HeroUISlider
      className={cn("w-full max-w-xs", className)}
      defaultValue={defaultValue}
      isDisabled={actualDisabled}
      maxValue={actualMax}
      minValue={actualMin}
      onChange={handleChange}
      orientation={orientation}
      step={step}
      value={value}
      {...props}
    >
      {label ? <Label>{label}</Label> : null}
      {showValueLabel ? <HeroUISlider.Output /> : null}
      <HeroUISlider.Track
        className={cn(
          orientation === "horizontal"
            ? "data-[fill-start=true]:border-s-primary data-[fill-end=true]:border-e-primary"
            : "data-[fill-start=true]:border-b-primary data-[fill-end=true]:border-t-primary"
        )}
      >
        <HeroUISlider.Fill className="bg-primary" />
        {Array.from({ length: values.length }, (_, index) => (
          <HeroUISlider.Thumb
            aria-label={thumbLabel}
            index={index}
            key={index}
            className="bg-primary"
          />
        ))}
      </HeroUISlider.Track>
    </HeroUISlider>
  );
}

export { Slider };
