import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-surface-2 text-muted shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)]",
        ok: "bg-ok/15 text-ok",
        fail: "bg-fail/15 text-fail",
        warn: "bg-warn/15 text-warn",
        solid: "bg-primary text-primary-fg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
