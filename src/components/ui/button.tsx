import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-transparent bg-[var(--foreground)] px-5 py-2.5 text-[var(--background)] hover:bg-[color-mix(in_oklab,var(--foreground)_84%,white)]',
        secondary:
          'border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-[var(--foreground)] hover:bg-[var(--surface-strong)]',
        ghost:
          'border-transparent bg-transparent px-3 py-2 text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]',
      },
      size: {
        md: 'h-11',
        sm: 'h-9 px-4 text-xs',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      type={type}
      {...props}
    />
  );
}
