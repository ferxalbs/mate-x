import { Input as InputPrimitive } from '@base-ui/react/input';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type InputProps = Omit<InputPrimitive.Props, 'size'> & {
  size?: 'sm' | 'default' | 'lg' | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

export function Input({
  className,
  size = 'default',
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    'h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-[color-mix(in_srgb,var(--muted-foreground)_72%,transparent)] sm:h-7.5 sm:leading-7.5',
    size === 'sm' && 'h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5',
    size === 'lg' && 'h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5',
  );

  return (
    <span
      className={
        cn(
          !unstyled &&
            'relative inline-flex w-full rounded-lg border border-[var(--input)] bg-[color-mix(in_srgb,var(--background)_88%,white_2%)] text-base text-[var(--foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.14)] transition-shadow focus-within:border-[var(--ring)] focus-within:ring-[3px] focus-within:ring-[color-mix(in_srgb,var(--ring)_18%,transparent)] sm:text-sm',
          className,
        ) || undefined
      }
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === 'number' ? size : undefined}
          {...(props as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === 'number' ? size : undefined}
          {...props}
        />
      )}
    </span>
  );
}

export type { InputProps };
