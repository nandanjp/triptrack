import type { ReactNode } from "react";
import { cn } from "cn";
import { Checkbox } from "@/ui/checkbox.tsx";

/**
 * shadcn's Checkbox is the control alone. These appear in groups — who was
 * there, who a cost is split between — where the whole row should be a hit
 * target, so the label wraps it.
 */
export function LabeledCheckbox({
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
        "inline-flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent",
        className,
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      {children}
    </label>
  );
}
