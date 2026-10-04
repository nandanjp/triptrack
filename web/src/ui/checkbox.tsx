import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Radix rather than a bare input: these appear in groups (who was there, who
 * a cost is split between) where label association and keyboard behaviour
 * matter more than the markup saved.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink transition-colors hover:bg-sunken",
        className,
      )}
    >
      <RadixCheckbox.Root
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="grid size-4 shrink-0 place-items-center rounded-sm border border-line-strong bg-raised transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <RadixCheckbox.Indicator>
          <Check className="size-3 text-accent-fg" strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {children}
    </label>
  );
}
