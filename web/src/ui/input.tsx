import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

const base =
  "w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-base text-ink transition-colors placeholder:text-subtle hover:border-line-strong focus:border-accent focus:outline-none disabled:opacity-50";

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input className={cn(base, className)} {...props} />
);

export const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => (
  <textarea className={cn(base, "min-h-20 resize-y", className)} {...props} />
);

/**
 * A styled native select rather than a Radix one: on a phone this opens the
 * platform picker, which is better than anything rebuilt in a div.
 */
export const Select = ({ className, ...props }: ComponentProps<"select">) => (
  <select
    className={cn(
      base,
      "cursor-pointer appearance-none bg-[length:16px] bg-[right_0.4rem_center] bg-no-repeat pr-7",
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b6f7b%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')]",
      className,
    )}
    {...props}
  />
);
