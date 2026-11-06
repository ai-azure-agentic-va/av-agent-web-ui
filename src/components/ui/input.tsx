import * as React from "react";

import { cn } from "@/lib/utils";

// The Text Field: the same grey outline, black-on-focus and red halo
// as Textarea, one line tall.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-signal/20 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-base transition-[color,box-shadow] outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
