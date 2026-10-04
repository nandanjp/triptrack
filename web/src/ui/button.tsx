import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // One filled button per view, so the primary action is obvious.
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        outline: "border border-line-strong bg-raised text-ink hover:bg-sunken",
        ghost: "text-muted hover:bg-sunken hover:text-ink",
        danger: "text-danger hover:bg-danger-soft",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2 text-sm",
        md: "h-8.5 px-3 text-sm",
        lg: "h-10 px-4 text-base",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>;

export const Button = ({ className, variant, size, ...props }: ButtonProps) => (
  <button type="button" className={cn(button({ variant, size }), className)} {...props} />
);
