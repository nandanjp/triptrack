import type { ReactNode } from "react";
import { cn } from "cn";
import { Label } from "@/ui/label.tsx";

/**
 * Label above control, hint or error below. Sentence case, never all caps — a
 * form label is a sentence fragment, not a heading.
 *
 * `min-w-0` matters more than it looks: a date or datetime input has a wide
 * intrinsic minimum, and grid and flex children default to `min-width: auto`,
 * so without this a two-column row of dates punches out of its dialog.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      {label !== undefined && <Label>{label}</Label>}
      {children}
      {error != null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        hint !== undefined && <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
