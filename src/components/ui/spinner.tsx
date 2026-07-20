import { Loading02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "~/lib/utils";

function Spinner({ className, ...props }: Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">) {
  return (
    <HugeiconsIcon icon={Loading02Icon as any}
      aria-label="Loading"
      className={cn("animate-spin motion-reduce:animate-none", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
