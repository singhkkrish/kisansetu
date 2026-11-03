import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select: works on every low-end phone and opens the system picker. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-12 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
