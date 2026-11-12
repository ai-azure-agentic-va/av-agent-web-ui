import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// One card for the whole app: white, the stepped corner, and a 1px
// outline whose colour says what kind of card it is.
//   flat       hairline; sits in the column (debug, nudge, attachments, tiles)
//   attention  black; the agent is waiting on the person (interrupts)
//   float      black plus the Float shadow; sits above the page (popovers)
// Only floating cards cast a shadow (the flat-page rule).
const cardVariants = cva("bg-background text-foreground corner-step border", {
  variants: {
    tone: {
      flat: "border-border",
      attention: "border-foreground",
      float: "border-foreground shadow-[0_12px_32px_rgb(0_0_0/0.12)]",
    },
    // A whole card that acts as one control: the hairline turns black on hover.
    interactive: {
      true: "hover:border-foreground focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2",
      false: "",
    },
  },
  defaultVariants: {
    tone: "flat",
    interactive: false,
  },
});

function Card({
  className,
  tone,
  ...props
}: React.ComponentProps<"div"> &
  Omit<VariantProps<typeof cardVariants>, "interactive">) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ tone }), className)}
      {...props}
    />
  );
}

// 40px head under a hairline rule. The right padding leaves a trailing 32px
// icon button 4px from the edge, the same inset as above and below it.
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "border-border flex min-h-10 items-center gap-3 border-b py-1 pr-1 pl-4",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  as: Comp = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "p" }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn(
        "text-foreground text-sm leading-5 font-semibold",
        className,
      )}
      {...props}
    />
  );
}

function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-body"
      className={cn("px-4 py-3", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "border-border flex items-center gap-2 border-t px-4 py-2.5",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardBody, CardFooter, cardVariants };
