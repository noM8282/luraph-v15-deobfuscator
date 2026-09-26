import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-48 w-full rounded-md bg-surface-2 px-3 py-3 text-sm leading-relaxed text-fg shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)] transition-[box-shadow] duration-150 placeholder:text-subtle focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_rgb(215_221_216_/_0.55)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
